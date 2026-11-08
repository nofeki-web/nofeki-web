import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing Supabase server environment variables.");
    return json(500, { ok: false, error: "server_configuration_error" });
  }

  // This endpoint uses its own revocable device token, not a Supabase user JWT.
  const bearer = req.headers.get("Authorization") ?? "";
  const token = bearer.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token || token.length < 32 || token.length > 512) {
    return json(401, { ok: false, error: "invalid_authorization" });
  }

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > 32_000) return json(413, { ok: false, error: "request_too_large" });
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return json(400, { ok: false, error: "invalid_json_body" });
  }
  if (new TextEncoder().encode(rawBody).byteLength > 32_000) {
    return json(413, { ok: false, error: "request_too_large" });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json(400, { ok: false, error: "invalid_json_body" });
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, error: "invalid_json_body" });
  }

  const baseUrl = supabaseUrl.replace(/\/$/, "");
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  try {
    const tokenHash = await sha256Hex(token);
    const authUrl = new URL(`${baseUrl}/rest/v1/shortcut_authorizations`);
    authUrl.searchParams.set("select", "id,user_id,expires_at");
    authUrl.searchParams.set("token_hash", `eq.${tokenHash}`);
    authUrl.searchParams.set("revoked_at", "is.null");
    authUrl.searchParams.set("limit", "1");

    const authRes = await fetch(authUrl, { headers });
    if (!authRes.ok) {
      console.error("Authorization lookup failed:", authRes.status);
      return json(500, { ok: false, error: "authorization_check_failed" });
    }
    const authRows = await authRes.json();
    if (!Array.isArray(authRows) || authRows.length !== 1) {
      return json(401, { ok: false, error: "unauthorized_or_revoked" });
    }
    const authRow = authRows[0];
    if (authRow.expires_at && new Date(authRow.expires_at).getTime() <= Date.now()) {
      return json(401, { ok: false, error: "authorization_expired" });
    }

  const description = typeof payload.description === "string" ? payload.description.trim() : "";
  const category = typeof payload.category === "string" ? payload.category.trim() : "";
  const amount = typeof payload.amount === "number" ? payload.amount : Number(payload.amount);
  const expenseTypeRaw = typeof payload.expense_type === "string" ? payload.expense_type.trim().normalize("NFC") : "";
  const expenseType = ({ necesario: "Necesario", discrecional: "Discrecional", deuda: "Deuda" } as Record<string, string>)[expenseTypeRaw.toLocaleLowerCase("es")] ?? expenseTypeRaw;
  const expenseDate = typeof payload.expense_date === "string" ? payload.expense_date : "";
  const paymentMethod = typeof payload.payment_method === "string" ? payload.payment_method.trim() : null;
  const note = typeof payload.note === "string" ? payload.note.trim() : null;
  const idempotencyKey = typeof payload.idempotency_key === "string" ? payload.idempotency_key.trim() : "";

  if (description.length < 2 || description.length > 200) {
    return json(400, { ok: false, error: "description_must_be_2_to_200_chars" });
  }
  if (category.length < 2 || category.length > 80) {
    return json(400, { ok: false, error: "category_must_be_2_to_80_chars" });
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000_000) {
    return json(400, { ok: false, error: "invalid_amount" });
  }
  if (!["Necesario", "Discrecional", "Deuda"].includes(expenseType)) {
    return json(400, { ok: false, error: "invalid_expense_type" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
    return json(400, { ok: false, error: "invalid_expense_date_use_YYYY_MM_DD" });
  }
  const date = new Date(`${expenseDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== expenseDate) {
    return json(400, { ok: false, error: "invalid_expense_date_use_YYYY_MM_DD" });
  }
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    return json(400, { ok: false, error: "idempotency_key_required_8_to_128_chars" });
  }
  if ((paymentMethod?.length ?? 0) > 80 || (note?.length ?? 0) > 1000) {
    return json(400, { ok: false, error: "optional_field_too_long" });
  }

    // Best-effort idempotency check. For strict race-proof deduplication, a
    // unique constraint on (user_id, idempotency_key) would be required.
    const existingUrl = new URL(`${baseUrl}/rest/v1/gastos`);
    existingUrl.searchParams.set("select", "id,expense_date,description,category,amount,expense_type,payment_method,note,source,idempotency_key,created_at");
    existingUrl.searchParams.set("user_id", `eq.${authRow.user_id}`);
    existingUrl.searchParams.set("idempotency_key", `eq.${idempotencyKey}`);
    existingUrl.searchParams.set("limit", "1");

    const existingRes = await fetch(existingUrl, { headers });
    if (!existingRes.ok) {
      console.error("Idempotency lookup failed:", existingRes.status);
      return json(500, { ok: false, error: "expense_lookup_failed" });
    }
    const existingRows = await existingRes.json();
    if (Array.isArray(existingRows) && existingRows.length > 0) {
      return json(200, { ok: true, duplicate: true, expense: existingRows[0] });
    }

    const insertRes = await fetch(`${baseUrl}/rest/v1/gastos`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: authRow.user_id,
        expense_date: expenseDate,
        description,
        category,
        amount,
        expense_type: expenseType,
        payment_method: paymentMethod || null,
        note: note || null,
        source: "shortcut",
        idempotency_key: idempotencyKey,
      }),
    });

    if (!insertRes.ok) {
      const errorText = await insertRes.text();
      // The unique (user_id, idempotency_key) index is the race-safe authority.
      // A concurrent retry that loses the insert race returns the original expense.
      if (insertRes.status === 409 || errorText.includes("23505")) {
        const retryRes = await fetch(existingUrl, { headers });
        if (retryRes.ok) {
          const retryRows = await retryRes.json();
          if (Array.isArray(retryRows) && retryRows.length > 0) {
            return json(200, { ok: true, duplicate: true, expense: retryRows[0] });
          }
        }
      }
      console.error("Expense insert failed:", insertRes.status, errorText.slice(0, 300));
      return json(500, { ok: false, error: "expense_insert_failed" });
    }
    const inserted = await insertRes.json();

    const touchUrl = new URL(`${baseUrl}/rest/v1/shortcut_authorizations`);
    touchUrl.searchParams.set("id", `eq.${authRow.id}`);
    const touchRes = await fetch(touchUrl, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ last_used_at: new Date().toISOString() }),
    });
    if (!touchRes.ok) console.error("Could not update last_used_at:", touchRes.status);

    return json(201, {
      ok: true,
      duplicate: false,
      expense: Array.isArray(inserted) ? inserted[0] : inserted,
    });
  } catch (error) {
    console.error("Unexpected function error:", error);
    return json(500, { ok: false, error: "internal_error" });
  }
});
