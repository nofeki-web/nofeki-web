// CANDIDATE ONLY — transactional PQR admin integration.
// Not deployed. Requires the companion RPC SQL candidate and isolated validation.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_EMAILS = ["nofeki07@gmail.com"];
const db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const statuses = ["Recibida", "En revisión", "En gestión", "Respondida", "Cerrada"];
const origins = ["https://nofeki.com", "https://www.nofeki.com"];
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && origins.includes(origin) ? origin : "https://www.nofeki.com",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, idempotency-key",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Vary": "Origin", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
});
const reply = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), { status, headers: cors(origin) });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (origin && !origins.includes(origin)) return reply({ ok: false, error: "Origen no autorizado." }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (!["GET", "POST"].includes(req.method)) return reply({ ok: false, error: "Método no permitido." }, 405, origin);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\\s+/i, "");
  if (!token) return reply({ ok: false, error: "Inicia sesión." }, 401, origin);
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user?.email) return reply({ ok: false, error: "Sesión inválida." }, 401, origin);
  if (!ADMIN_EMAILS.includes(user.email.toLowerCase())) return reply({ ok: false, error: "No tienes permisos para administrar PQR." }, 403, origin);

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const reference = url.searchParams.get("reference");
      if (reference) {
        const { data: submission, error } = await db.from("pqr_submissions").select("*").eq("reference_code", reference).maybeSingle();
        if (error) throw error;
        if (!submission) return reply({ ok: false, error: "Radicado no encontrado." }, 404, origin);
        const { data: events, error: eventError } = await db.from("pqr_events").select("*").eq("submission_id", submission.id).order("created_at", { ascending: true });
        if (eventError) throw eventError;
        let attachment_url: string | null = null;
        if (submission.attachment_path) {
          const { data, error: signedError } = await db.storage.from("pqr-attachments").createSignedUrl(submission.attachment_path, 300);
          if (signedError) throw signedError;
          attachment_url = data.signedUrl;
        }
        return reply({ ok: true, submission, events: events || [], attachment_url }, 200, origin);
      }
      const status = url.searchParams.get("status");
      const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
      let query = db.from("pqr_submissions").select("id,reference_code,request_type,full_name,email,subject,status,notification_status,created_at,updated_at").order("created_at", { ascending: false }).limit(100);
      if (status && statuses.includes(status)) query = query.eq("status", status);
      if (q) query = query.or("reference_code.ilike.%"+q+"%,full_name.ilike.%"+q+"%,email.ilike.%"+q+"%,subject.ilike.%"+q+"%");
      const { data, error } = await query;
      if (error) throw error;
      return reply({ ok: true, submissions: data || [] }, 200, origin);
    }

    const body = await req.json();
    const reference = String(body.reference || "").trim();
    const action = String(body.action || "");
    const requestKey = req.headers.get("Idempotency-Key") || "";
    if (!reference) return reply({ ok: false, error: "Falta el radicado." }, 400, origin);
    if (!uuidPattern.test(requestKey)) return reply({ ok: false, error: "Falta una clave de idempotencia válida." }, 400, origin);

    const { data: row, error: lookupError } = await db.from("pqr_submissions").select("id,reference_code,status,version").eq("reference_code", reference).maybeSingle();
    if (lookupError) throw lookupError;
    if (!row) return reply({ ok: false, error: "Radicado no encontrado." }, 404, origin);

    const fingerprintInput = { action, reference, status: action === "status" ? String(body.status || "") : null, note: action === "note" || action === "status" ? String(body.note || "").trim() : null, response: action === "respond" ? String(body.response || "").trim() : null };
    const fingerprintBytes = new TextEncoder().encode(JSON.stringify(fingerprintInput));
    const fingerprintHash = await crypto.subtle.digest("SHA-256", fingerprintBytes);
    const fingerprint = Array.from(new Uint8Array(fingerprintHash)).map((b) => b.toString(16).padStart(2, "0")).join("");

    let rpcName: string;
    let rpcArgs: Record<string, unknown>;
    if (action === "status") {
      const next = String(body.status || "");
      if (!statuses.includes(next)) return reply({ ok: false, error: "Estado no válido." }, 400, origin);
      if (next === "Respondida") return reply({ ok: false, error: "El estado Respondida solo se asigna al registrar una respuesta formal." }, 409, origin);
      rpcName = "pqr_admin_transition_status";
      rpcArgs = { p_submission_id: row.id, p_expected_status: row.status, p_expected_version: row.version ?? 1, p_target_status: next, p_request_id: requestKey, p_request_fingerprint: fingerprint, p_actor_email: user.email, p_reason: String(body.note || "").slice(0, 2000) || null };
    } else if (action === "note") {
      const note = String(body.note || "").trim().slice(0, 4000);
      if (!note) return reply({ ok: false, error: "Escribe la nota interna." }, 400, origin);
      rpcName = "pqr_admin_add_note_v2";
      rpcArgs = { p_request_key: requestKey, p_submission_id: row.id, p_request_fingerprint: fingerprint, p_note: note, p_actor_email: user.email };
    } else if (action === "respond") {
      const response = String(body.response || "").trim().slice(0, 5000);
      if (response.length < 5) return reply({ ok: false, error: "La respuesta debe tener al menos 5 caracteres." }, 400, origin);
      rpcName = "pqr_admin_create_response";
      rpcArgs = { p_submission_id: row.id, p_expected_version: row.version ?? 1, p_request_id: requestKey, p_request_fingerprint: fingerprint, p_actor_email: user.email, p_response: response };
    } else if (action === "retry_notification") {
      rpcName = "pqr_admin_retry_notification_v2";
      rpcArgs = { p_request_key: requestKey, p_submission_id: row.id, p_request_fingerprint: fingerprint, p_actor_email: user.email };
    } else {
      return reply({ ok: false, error: "Acción no reconocida." }, 400, origin);
    }

    const { data, error } = await db.rpc(rpcName, rpcArgs);
    if (error) {
      if (error.code === "PT409" || error.message?.includes("idempotency_key_conflict")) return reply({ ok: false, error: "La clave ya fue usada con otro contenido. Recarga el caso y vuelve a intentar." }, 409, origin);
      if (error.code === "P0002") return reply({ ok: false, error: "La solicitud no existe o no permite esta operación." }, 409, origin);
      console.error("PQR admin RPC failed", { rpcName, code: error.code, message: error.message });
      throw error;
    }
    return reply({ ok: true, result: data }, 200, origin);
  } catch (error) {
    console.error("pqr-admin candidate error", error);
    return reply({ ok: false, error: "No fue posible procesar la solicitud." }, 500, origin);
  }
});
