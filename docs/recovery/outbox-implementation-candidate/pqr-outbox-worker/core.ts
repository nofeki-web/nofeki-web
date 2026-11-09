// Pure worker rules — isolated for Deno unit tests; no network or Supabase side effects.
export type OutboxEvent = {
  outbox_id: string; submission_id: string; source_event_id: string | null;
  event_key: string;
  event_type: "applicant_confirmation" | "internal_alert" | "admin_response";
  lease_token: string; attempt_number: number; lease_expires_at: string;
};
export type Submission = {
  id: string; reference_code: string; request_type: string;
  full_name: string; email: string; subject: string; message: string;
};
export type Mail = { to: string; subject: string; html: string };

export const RETRY_DELAYS_SECONDS = [30, 120, 600, 1_800, 3_600, 7_200, 14_400, 21_600] as const;

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]!);

export function constantTimeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a), bb = new TextEncoder().encode(b);
  let diff = aa.length ^ bb.length;
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export function retryDelaySeconds(attemptNumber: number): number {
  const index = Math.min(Math.max(attemptNumber - 1, 0), RETRY_DELAYS_SECONDS.length - 1);
  return RETRY_DELAYS_SECONDS[index];
}

export function sanitizeErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : "unknown_error";
  return /missing_|lookup_failed|not_configured/.test(raw)
    ? raw.slice(0, 80)
    : /^resend_http_\d{3}$/.test(raw) ? raw : "transient_delivery_error";
}

export function buildMail(event: OutboxEvent, row: Submission, responseText: string | null, notifyEmail = ""): Mail {
  const reference = escapeHtml(row.reference_code), name = escapeHtml(row.full_name);
  if (event.event_type === "applicant_confirmation") return {
    to: row.email, subject: "Confirmación de radicación " + row.reference_code,
    html: `<p>Hola ${name},</p><p>Tu solicitud fue recibida por NOFEKI.</p><p>Radicado: <strong>${reference}</strong></p><p>Conserva este número para futuras consultas.</p>`,
  };
  if (event.event_type === "internal_alert") {
    if (!notifyEmail) throw new Error("missing_notify_recipient");
    return {
    to: notifyEmail, subject: "Nueva solicitud PQR " + row.reference_code,
    html: `<p>Radicado: <strong>${reference}</strong></p><p>Tipo: ${escapeHtml(row.request_type)}</p><p>Solicitante: ${name} (${escapeHtml(row.email)})</p><p>Asunto: ${escapeHtml(row.subject)}</p><p>${escapeHtml(row.message).replace(/\\n/g, "<br>")}</p>`,
  };
  }
  if (!responseText) throw new Error("missing_response_event");
  return {
    to: row.email, subject: "Respuesta a tu solicitud " + row.reference_code,
    html: `<p>Hola ${name},</p><p>Hemos actualizado tu solicitud <strong>${reference}</strong>.</p><p>${escapeHtml(responseText).replace(/\\n/g, "<br>")}</p><p>Equipo NOFEKI</p>`,
  };
}
