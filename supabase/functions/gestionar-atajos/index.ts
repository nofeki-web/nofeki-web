import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigins = new Set(["https://nofeki.com", "https://www.nofeki.com", "https://nofeki-itr22308e-nofeki.vercel.app", "https://nofeki-r6lyxohf9-nofeki.vercel.app", "https://nofeki-26c0w85uj-nofeki.vercel.app", "https://nofeki-web-git-fix-gastos-session-and-actions-nofeki.vercel.app"]);
function headers(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://nofeki.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}
function json(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: headers(req) });
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(req) });
  if (req.method !== "GET" && req.method !== "POST") return json(req, 405, { ok: false, error: "method_not_allowed" });
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !serviceKey) return json(req, 500, { ok: false, error: "server_configuration_error" });
  const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return json(req, 401, { ok: false, error: "login_required" });
  const userRes = await fetch(base + "/auth/v1/user", { headers: { apikey: serviceKey, Authorization: "Bearer " + token } });
  if (!userRes.ok) return json(req, 401, { ok: false, error: "invalid_session" });
  const user = await userRes.json();
  if (!user?.id) return json(req, 401, { ok: false, error: "invalid_session" });
  const restHeaders = { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" };
  if (req.method === "GET") {
    const url = new URL(base + "/rest/v1/shortcut_authorizations");
    url.searchParams.set("select", "id,device_name,created_at,expires_at,revoked_at,last_used_at");
    url.searchParams.set("user_id", "eq." + user.id);
    url.searchParams.set("order", "created_at.desc");
    url.searchParams.set("limit", "50");
    const res = await fetch(url, { headers: restHeaders });
    if (!res.ok) return json(req, 500, { ok: false, error: "authorization_list_failed" });
    const rows = await res.json();
    return json(req, 200, { ok: true, authorizations: Array.isArray(rows) ? rows : [] });
  }
  let body: Record<string, unknown>;
  try { const parsed = await req.json(); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); body = parsed; }
  catch { return json(req, 400, { ok: false, error: "invalid_json_body" }); }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return json(req, 400, { ok: false, error: "invalid_authorization_id" });
  const url = new URL(base + "/rest/v1/shortcut_authorizations");
  url.searchParams.set("id", "eq." + id);
  url.searchParams.set("user_id", "eq." + user.id);
  url.searchParams.set("revoked_at", "is.null");
  const res = await fetch(url, { method: "PATCH", headers: { ...restHeaders, Prefer: "return=representation" }, body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 500);
    console.error("Shortcut authorization revoke failed:", res.status, detail);
    return json(req, 500, { ok: false, error: "authorization_revoke_failed" });
  }
  const rows = await res.json().catch(() => []);
  if (!Array.isArray(rows) || rows.length === 0) return json(req, 404, { ok: false, error: "authorization_not_found_or_already_revoked" });
  return json(req, 200, { ok: true, revoked: true, authorization: rows[0] });
});