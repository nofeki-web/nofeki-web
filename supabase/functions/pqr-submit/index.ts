import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PROJECT_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(PROJECT_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const allowedOrigins = new Set(["https://nofeki.com", "https://www.nofeki.com"]);
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("PQR_FROM_EMAIL") || "";
const NOTIFY_EMAIL = Deno.env.get("PQR_NOTIFICATION_EMAIL") || "nofeki07@gmail.com";

const sendMail = async (to: string, subject: string, html: string) => {
  if (!RESEND_KEY || !FROM_EMAIL) return "not_configured";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  if (!response.ok) throw new Error("Resend HTTP " + response.status);
  return "sent";
};
const escapeHtml = (value: string) =>
  value.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://www.nofeki.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
});
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origen no autorizado." }, 403, origin);

  try {
    const declaredLength = Number(req.headers.get("content-length") || "0");
    if (declaredLength > 7_500_000) return json({ error: "La solicitud supera el tamaño permitido." }, 413, origin);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 7_500_000) return json({ error: "La solicitud supera el tamaño permitido." }, 413, origin);
    let data: Record<string, any>;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
      data = parsed;
    } catch {
      return json({ error: "Formato de solicitud inválido." }, 400, origin);
    }

    if (typeof data.website === "string" && data.website.trim() !== "") {
      return json({ ok: true, reference: "Recibida" }, 200, origin);
    }

    const types = ["Petición", "Queja", "Reclamo", "Sugerencia", "Protección de datos", "Otra solicitud"];
    const requestType = String(data.request_type ?? "");
    const fullName = String(data.full_name ?? "").trim();
    const email = String(data.email ?? "").trim().toLowerCase();
    const subject = String(data.subject ?? "").trim();
    const message = String(data.message ?? "").trim();
    const consent = data.consent === true;

    if (!types.includes(requestType)) return json({ error: "Selecciona un tipo de solicitud válido." }, 400, origin);
    if (fullName.length < 2 || fullName.length > 120) return json({ error: "Revisa el nombre ingresado." }, 400, origin);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Ingresa un correo electrónico válido." }, 400, origin);
    if (subject.length < 3 || subject.length > 160) return json({ error: "El asunto debe tener entre 3 y 160 caracteres." }, 400, origin);
    if (message.length < 10 || message.length > 5000) return json({ error: "La descripción debe tener entre 10 y 5.000 caracteres." }, 400, origin);
    if (!consent) return json({ error: "Debes autorizar el tratamiento de datos para radicar la solicitud." }, 400, origin);

    // Use proxy-provided client IP headers; never trust the caller-controlled X-Forwarded-For chain.
    const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY") || "";
    const turnstileToken = String(
      data.turnstileToken ?? data.turnstile_token ?? data["cf-turnstile-response"] ?? ""
    ).trim();
    if (!turnstileSecret) {
      console.error("TURNSTILE_SECRET_KEY is not configured");
      return json({ error: "La validación de seguridad no está disponible temporalmente." }, 503, origin);
    }
    if (!turnstileToken || turnstileToken.length > 2048) {
      return json({ error: "Completa la verificación de seguridad e inténtalo nuevamente." }, 400, origin);
    }
    let turnstileResult: { success?: boolean; hostname?: string; ["error-codes"]?: string[] };
    try {
      const verifyBody = new URLSearchParams({
        secret: turnstileSecret,
        response: turnstileToken,
      });
      const verifyResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: verifyBody,
        signal: AbortSignal.timeout(8000),
      });
      if (!verifyResponse.ok) throw new Error("Turnstile verification HTTP " + verifyResponse.status);
      turnstileResult = await verifyResponse.json();
    } catch (verificationError) {
      console.error("Turnstile verification unavailable", verificationError);
      return json({ error: "No fue posible validar la verificación de seguridad. Intenta nuevamente." }, 503, origin);
    }
    if (turnstileResult.success !== true ||
        !["nofeki.com", "www.nofeki.com"].includes(String(turnstileResult.hostname || "").toLowerCase())) {
      console.warn("Turnstile rejected PQR submission", turnstileResult["error-codes"] || []);
      return json({ error: "La verificación de seguridad expiró o no es válida. Inténtalo nuevamente." }, 403, origin);
    }

    const clientIp = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
    const sourceHash = await sha256(clientIp.trim() + "|nofeki-pqr-v2");
    const { data: allowed, error: rateError } = await admin.rpc("pqr_consume_rate_limit", {
      p_source_hash: sourceHash,
      p_limit: 5,
      p_window_seconds: 3600,
    });
    if (rateError) {
      console.error("pqr rate limit service error", rateError);
      return json({ error: "El servicio está temporalmente ocupado. Intenta nuevamente más tarde." }, 503, origin);
    }
    if (allowed !== true) return json({ error: "Has alcanzado el límite temporal de radicaciones. Intenta nuevamente más tarde." }, 429, origin);

    const id = crypto.randomUUID();
    const reference = `NFK-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`;
    let attachmentPath: string | null = null;

    if (data.attachment && typeof data.attachment === "object") {
      const mime = String(data.attachment.mime ?? "");
      const base64 = String(data.attachment.base64 ?? "");
      const extByMime: Record<string, string> = {
        "application/pdf": "pdf",
        "image/jpeg": "jpg",
        "image/png": "png",
      };
      if (!extByMime[mime] || !base64 || base64.length > 7_000_000) {
        return json({ error: "El adjunto debe ser PDF, JPG o PNG y no superar 5 MB." }, 400, origin);
      }
      let binary: Uint8Array;
      try {
        binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      } catch {
        return json({ error: "El archivo adjunto no tiene un formato válido." }, 400, origin);
      }
      if (binary.length > 5 * 1024 * 1024) return json({ error: "El adjunto supera 5 MB." }, 400, origin);
      const signatureOk =
        (mime === "application/pdf" && new TextDecoder().decode(binary.slice(0, 5)) === "%PDF-") ||
        (mime === "image/jpeg" && binary[0] === 0xff && binary[1] === 0xd8 && binary[2] === 0xff) ||
        (mime === "image/png" && binary[0] === 0x89 && new TextDecoder().decode(binary.slice(1, 4)) === "PNG");
      if (!signatureOk) return json({ error: "El archivo no coincide con el formato declarado." }, 400, origin);
      attachmentPath = `${reference}/soporte.${extByMime[mime]}`;
      const { error: uploadError } = await admin.storage.from("pqr-attachments").upload(attachmentPath, binary, {
        contentType: mime,
        upsert: false,
      });
      if (uploadError) throw uploadError;
    }

    const { error: insertError } = await admin.from("pqr_submissions").insert({
      id,
      reference_code: reference,
      request_type: requestType,
      full_name: fullName,
      email,
      subject,
      message,
      attachment_path: attachmentPath,
      privacy_version: "1.3",
      source_hash: sourceHash,
    });
    if (insertError) {
      if (attachmentPath) await admin.storage.from("pqr-attachments").remove([attachmentPath]);
      throw insertError;
    }

    let notificationStatus = "not_configured";
    let notificationError: string | null = null;
    try {
      const confirmation = await sendMail(email, "Confirmación de radicación " + reference,
        "<p>Hola " + escapeHtml(fullName) + ",</p><p>Tu solicitud fue recibida por NOFEKI.</p><p>Radicado: <strong>" + reference + "</strong></p><p>Conserva este número para futuras consultas.</p>");
      const internal = await sendMail(NOTIFY_EMAIL, "Nueva solicitud PQR " + reference,
        "<p>Radicado: <strong>" + reference + "</strong></p><p>Tipo: " + escapeHtml(requestType) + "</p><p>Solicitante: " + escapeHtml(fullName) + " (" + escapeHtml(email) + ")</p><p>Asunto: " + escapeHtml(subject) + "</p><p>" + escapeHtml(message) + "</p>");
      notificationStatus = confirmation === "sent" && internal === "sent" ? "sent" : "not_configured";
    } catch (mailError) {
      notificationStatus = "failed";
      notificationError = "No fue posible completar las notificaciones.";
      console.error("pqr notification error", mailError);
    }
    const { error: notificationUpdateError } = await admin.from("pqr_submissions").update({
      notification_status: notificationStatus,
      notification_error: notificationError,
      notification_sent_at: notificationStatus === "sent" ? new Date().toISOString() : null,
    }).eq("id", id);

    if (notificationUpdateError) {
      // The PQR itself is already stored. Do not tell the applicant that
      // submission failed; expose the persistence warning for operational review.
      console.error("PQR created but notification status could not be saved", {
        reference,
        code: notificationUpdateError.code,
      });
    }

    return json({
      ok: true,
      reference,
      notification_status: notificationStatus,
      notification_status_persisted: !notificationUpdateError,
      message: "Tu solicitud fue radicada correctamente.",
    }, 201, origin);
  } catch (error) {
    console.error("pqr-submit error", error);
    return json({ error: "No fue posible radicar tu solicitud. Intenta nuevamente o escríbenos a nofeki07@gmail.com." }, 500, origin);
  }
});