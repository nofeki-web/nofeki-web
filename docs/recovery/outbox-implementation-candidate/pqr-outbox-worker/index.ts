// NOFEKI PQR transactional Outbox worker — CANDIDATE ONLY.
// Do not copy into supabase/functions or deploy until the SQL candidate has
// passed PostgreSQL integration tests and the owner approves rollout.
//
// Required Edge Function secrets (server-side only):
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
// PQR_FROM_EMAIL, PQR_NOTIFY_EMAIL, PQR_OUTBOX_WORKER_SECRET.
//
// Invocation: POST with Authorization: Bearer <PQR_OUTBOX_WORKER_SECRET>.
// Schedule/cron is intentionally not configured by this candidate.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type OutboxEvent = {
  outbox_id: string;
  submission_id: string;
  source_event_id: string | null;
  event_key: string;
  event_type: "applicant_confirmation" | "internal_alert" | "admin_response";
  lease_token: string;
  attempt_number: number;
  lease_expires_at: string;
};

type Submission = {
  id: string;
  reference_code: string;
  request_type: string;
  full_name: string;
  email: string;
  subject: string;
  message: string;
};

type Mail = { to: string; subject: string; html: string };

const env = (name: string) => Deno.env.get(name)?.trim() ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = env("RESEND_API_KEY");
const FROM_EMAIL = env("PQR_FROM_EMAIL");
const NOTIFY_EMAIL = env("PQR_NOTIFY_EMAIL");
const WORKER_SECRET = env("PQR_OUTBOX_WORKER_SECRET");

const MAX_BATCH = 5;
const LEASE_SECONDS = 180;
const PROVIDER_TIMEOUT_MS = 12_000;

// Exponential schedule totals less than Resend's documented 24-hour
// idempotency-key retention window. Never retry this same event after 24h.
const RETRY_DELAYS_SECONDS = [30, 120, 600, 1_800, 3_600, 7_200, 14_400, 21_600];

const db = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

function constantTimeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = aa.length ^ bb.length;
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function buildMail(event: OutboxEvent, row: Submission, responseText: string | null): Mail {
  const reference = escapeHtml(row.reference_code);
  const name = escapeHtml(row.full_name);
  if (event.event_type === "applicant_confirmation") {
    return {
      to: row.email,
      subject: "Confirmación de radicación " + row.reference_code,
      html: `<p>Hola ${name},</p><p>Tu solicitud fue recibida por NOFEKI.</p><p>Radicado: <strong>${reference}</strong></p><p>Conserva este número para futuras consultas.</p>`,
    };
  }
  if (event.event_type === "internal_alert") {
    if (!NOTIFY_EMAIL) throw new Error("missing_notify_recipient");
    return {
      to: NOTIFY_EMAIL,
      subject: "Nueva solicitud PQR " + row.reference_code,
      html: `<p>Radicado: <strong>${reference}</strong></p><p>Tipo: ${escapeHtml(row.request_type)}</p><p>Solicitante: ${name} (${escapeHtml(row.email)})</p><p>Asunto: ${escapeHtml(row.subject)}</p><p>${escapeHtml(row.message).replace(/\n/g, "<br>")}</p>`,
    };
  }
  if (!responseText) throw new Error("missing_response_event");
  return {
    to: row.email,
    subject: "Respuesta a tu solicitud " + row.reference_code,
    html: `<p>Hola ${name},</p><p>Hemos actualizado tu solicitud <strong>${reference}</strong>.</p><p>${escapeHtml(responseText).replace(/\n/g, "<br>")}</p><p>Equipo NOFEKI</p>`,
  };
}

async function sendWithResend(mail: Mail, eventKey: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + RESEND_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": eventKey,
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [mail.to], subject: mail.subject, html: mail.html }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Do not persist provider response bodies; they may contain recipient data.
    throw new Error("resend_http_" + response.status);
  }
  const id = typeof payload?.id === "string" ? payload.id : null;
  if (!id) throw new Error("resend_missing_message_id");
  return id;
}

async function processOne(event: OutboxEvent) {
  if (!db) throw new Error("database_client_not_configured");

  const { data: submission, error: submissionError } = await db
    .from("pqr_submissions")
    .select("id,reference_code,request_type,full_name,email,subject,message")
    .eq("id", event.submission_id)
    .maybeSingle();
  if (submissionError || !submission) throw new Error("submission_lookup_failed");

  let responseText: string | null = null;
  if (event.event_type === "admin_response") {
    if (!event.source_event_id) throw new Error("missing_source_event_id");
    const { data: sourceEvent, error: sourceError } = await db
      .from("pqr_events")
      .select("id,response,event_type")
      .eq("id", event.source_event_id)
      .maybeSingle();
    if (sourceError || !sourceEvent || sourceEvent.event_type !== "response_sent" ||
        typeof sourceEvent.response !== "string" || sourceEvent.response.trim().length < 5) {
      throw new Error("response_event_lookup_failed");
    }
    responseText = sourceEvent.response;
  }

  const mail = buildMail(event, submission as Submission, responseText);
  const providerMessageId = await sendWithResend(mail, event.event_key);

  const { data: finished, error: finishError } = await db.rpc("pqr_outbox_finish", {
    p_outbox_id: event.outbox_id,
    p_lease_token: event.lease_token,
    p_provider_message_id: providerMessageId,
  });
  if (finishError) throw new Error("outbox_finish_rpc_failed");
  if (finished !== true) {
    // The lease was superseded. A later worker will retry with the same
    // event_key; Resend deduplicates within its 24-hour retention window.
    return "stale_lease";
  }
  return "delivered";
}

async function retryOne(event: OutboxEvent, error: unknown) {
  if (!db) return "database_client_not_configured";
  const delay = RETRY_DELAYS_SECONDS[Math.min(
    Math.max(event.attempt_number - 1, 0),
    RETRY_DELAYS_SECONDS.length - 1,
  )];
  const rawCode = error instanceof Error ? error.message : "unknown_error";
  // Persist only a fixed, sanitized category—not raw provider messages.
  const safeCode = /missing_|lookup_failed|not_configured/.test(rawCode)
    ? rawCode.slice(0, 80)
    : /^resend_http_\d{3}$/.test(rawCode)
      ? rawCode
      : "transient_delivery_error";
  const { data, error: retryError } = await db.rpc("pqr_outbox_retry", {
    p_outbox_id: event.outbox_id,
    p_lease_token: event.lease_token,
    p_error_code: safeCode,
    p_delay_seconds: delay,
  });
  if (retryError) throw new Error("outbox_retry_rpc_failed");
  return typeof data === "string" ? data : "unknown_retry_state";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!WORKER_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY || !RESEND_API_KEY || !FROM_EMAIL) {
    console.error("PQR outbox worker configuration incomplete");
    return json({ ok: false, error: "worker_not_configured" }, 503);
  }
  const auth = req.headers.get("authorization") ?? "";
  const supplied = auth.replace(/^Bearer\s+/i, "");
  if (!supplied || !constantTimeEqual(supplied, WORKER_SECRET)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  try {
    const { data: claimed, error: claimError } = await db!.rpc("pqr_outbox_claim", {
      p_batch_size: MAX_BATCH,
      p_lease_seconds: LEASE_SECONDS,
    });
    if (claimError) {
      console.error("PQR outbox claim failed", { code: claimError.code });
      return json({ ok: false, error: "claim_failed" }, 503);
    }

    const events = (claimed ?? []) as OutboxEvent[];
    const counts = { claimed: events.length, delivered: 0, retrying: 0, dead: 0, stale: 0, errors: 0 };
    for (const event of events) {
      try {
        const result = await processOne(event);
        if (result === "delivered") counts.delivered++;
        else counts.stale++;
      } catch (error) {
        counts.errors++;
        try {
          const state = await retryOne(event, error);
          if (state === "pending") counts.retrying++;
          else if (state === "dead") counts.dead++;
          else counts.stale++;
          console.warn("PQR outbox delivery deferred", {
            outbox_id: event.outbox_id,
            attempt: event.attempt_number,
            state,
            error_code: error instanceof Error ? error.message.slice(0, 80) : "unknown_error",
          });
        } catch (retryError) {
          // Do not release a lease if persistence failed; it will expire and
          // be reclaimed safely with the same provider idempotency key.
          console.error("PQR outbox retry persistence failed", {
            outbox_id: event.outbox_id,
            error_code: retryError instanceof Error ? retryError.message : "unknown_error",
          });
        }
      }
    }
    return json({ ok: true, ...counts });
  } catch (error) {
    console.error("PQR outbox worker failed", {
      error_code: error instanceof Error ? error.message : "unknown_error",
    });
    return json({ ok: false, error: "worker_failed" }, 500);
  }
});
