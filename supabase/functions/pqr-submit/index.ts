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
  const response = await fetch("https://api.resend.com/emails", { method:"POST", headers:{Authorization:"Bearer "+RESEND_KEY,"Content-Type":"application/json"}, body:JSON.stringify({from:FROM_EMAIL,to:[to],subject,html}) });
  if (!response.ok) throw new Error("Resend HTTP "+response.status);
  return "sent";
};
const escapeHtml = (value: string) => value.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]!));

const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://www.nofeki.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origen no autorizado." }, 403, origin);

  try {
    const raw = await req.text();
    if (raw.length > 7_500_000) return json({ error: "La solicitud supera el tamaño permitido." }, 413, origin);
    const data = JSON.parse(raw);

    // Campo trampa para bots: debe permanecer vacío.
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

    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const source = forwarded || req.headers.get("cf-connecting-ip") || req.headers.get("user-agent") || "unknown";
    const sourceHash = await sha256(source + "|nofeki-pqr-v1");
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: rateError } = await admin
      .from("pqr_submissions")
      .select("id", { count: "exact", head: true })
      .eq("source_hash", sourceHash)
      .gte("created_at", since);
    if (rateError) throw rateError;
    if ((count ?? 0) >= 5) return json({ error: "Has alcanzado el límite temporal de radicaciones. Intenta nuevamente más tarde." }, 429, origin);

    const id = crypto.randomUUID();
    const reference = `NFK-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`;
    let attachmentPath: string | null = null;

    if (data.attachment && typeof data.attachment === "object") {
      const mime = String(data.attachment.mime ?? "");
      const filename = String(data.attachment.name ?? "soporte").slice(0, 120);
      const base64 = String(data.attachment.base64 ?? "");
      const extByMime: Record<string, string> = {
        "application/pdf": "pdf",
        "image/jpeg": "jpg",
        "image/png": "png",
      };
      if (!extByMime[mime] || !base64 || base64.length > 7_000_000) {
        return json({ error: "El adjunto debe ser PDF, JPG o PNG y no superar 5 MB." }, 400, origin);
      }
      const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
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
      const confirmation = await sendMail(email, "Confirmación de radicación " + reference, "<p>Hola " + escapeHtml(fullName) + ",</p><p>Tu solicitud fue recibida por NOFEKI.</p><p>Radicado: <strong>" + reference + "</strong></p><p>Conserva este número para futuras consultas.</p>");
      const internal = await sendMail(NOTIFY_EMAIL, "Nueva solicitud PQR " + reference, "<p>Radicado: <strong>" + reference + "</strong></p><p>Tipo: " + escapeHtml(requestType) + "</p><p>Solicitante: " + escapeHtml(fullName) + " (" + escapeHtml(email) + ")</p><p>Asunto: " + escapeHtml(subject) + "</p><p>" + escapeHtml(message) + "</p>");
      notificationStatus = confirmation === "sent" && internal === "sent" ? "sent" : "not_configured";
    } catch (mailError) { notificationStatus = "failed"; notificationError = "No fue posible completar las notificaciones."; console.error("pqr notification error", mailError); }
    await admin.from("pqr_submissions").update({notification_status:notificationStatus,notification_error:notificationError,notification_sent_at:notificationStatus === "sent" ? new Date().toISOString() : null}).eq("id",id);
    return json({ok:true,reference,notification_status:notificationStatus,message:"Tu solicitud fue radicada correctamente."},201,origin);
  } catch (error) {
    console.error("pqr-submit error", error);
    return json({ error: "No fue posible radicar tu solicitud. Intenta nuevamente o escríbenos a nofeki07@gmail.com." }, 500, origin);
  }
});