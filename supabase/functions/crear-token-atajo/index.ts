import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigins = new Set(["https://nofeki.com", "https://www.nofeki.com"]);
function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://nofeki.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8"
  };
}
function json(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, 405, { ok: false, error: "method_not_allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(req, 500, { ok: false, error: "server_configuration_error" });

  const authHeader = req.headers.get("Authorization") ?? "";
  const accessToken = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!accessToken) return json(req, 401, { ok: false, error: "login_required" });

  const baseUrl = supabaseUrl.replace(/\/$/, "");
  const userRes = await fetch(`${baseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
  });
  if (!userRes.ok) return json(req, 401, { ok: false, error: "invalid_session" });
  const user = await userRes.json();
  if (!user?.id) return json(req, 401, { ok: false, error: "invalid_session" });

  let deviceName = "iPhone NOFEKI";
  try {
    const body = await req.json();
    if (typeof body?.device_name === "string" && body.device_name.trim()) deviceName = body.device_name.trim().slice(0, 80);
  } catch { /* optional body */ }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const issueRes = await fetch(`${baseUrl}/rest/v1/rpc/issue_shortcut_authorization`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_user_id: user.id, p_token_hash: tokenHash, p_device_name: deviceName, p_expires_at: expiresAt })
  });
  if (!issueRes.ok) {
    console.error("Atomic shortcut authorization failed:", issueRes.status, (await issueRes.text()).slice(0, 300));
    return json(req, 500, { ok: false, error: "authorization_creation_failed" });
  }
  const issued = await issueRes.json();
  if (issued !== true) return json(req, 409, { ok: false, error: "active_authorization_exists", message: "Ya tienes una conexión de atajo activa. Revócala antes de vincular otro iPhone." });
  return json(req, 201, { ok: true, token, device_name: deviceName, message: "Copia este token ahora. Por seguridad no se puede volver a consultar." });
});