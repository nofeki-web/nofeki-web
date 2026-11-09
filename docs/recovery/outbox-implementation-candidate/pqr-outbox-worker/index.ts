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
import { buildMail, constantTimeEqual, retryDelaySeconds, sanitizeErrorCode, type OutboxEvent, type Submission } from "./core.ts";

import { createClient } from "npm:@supabase/supabase-js@2";

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
const db = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

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
  const delay = retryDelaySeconds(event.attempt_number);
  const safeCode = sanitizeErrorCode(error);
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
