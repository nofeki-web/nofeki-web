# NOFEKI PQR — Outbox implementation candidate (2026-11-08)

> **Candidate only. Not deployed. Not a migration. No production schema, data, secrets, functions or emails were changed.**

## 1. Decision from live inspection

- Database: PostgreSQL 17.11.
- The `private`, `pgmq`, and `pgmq_public` schemas were absent.
- The `pgmq` extension is available in the extension catalog but is not installed.
- To avoid silently enabling an extension and expanding the infrastructure footprint, the first candidate uses a small table-backed outbox in a future `private` schema. A later decision can compare it with Supabase Queues after cost/operational review.
- The existing `public.pqr_consume_rate_limit` remains untouched.

## 2. Candidate files

- `PQR_OUTBOX_REFERENCE_CANDIDATE_NOT_EXECUTABLE.sql`: additive table and restricted RPC draft for queue leases.
- This document: architecture, invariants, implementation sequence and test gates.

The SQL is intentionally not placed under `supabase/migrations` and must not be executed against production.

## 3. Event model

Each logical email is a separate durable event:

| Event | Created by | Recipient/data source |
|---|---|---|
| `applicant_confirmation` | successful PQR creation | applicant email and reference |
| `internal_alert` | successful PQR creation | configured internal notification address |
| `admin_response` | persisted admin response | applicant email and stored response |

The outbox stores only submission ID and event metadata, not duplicated PII or message body. The worker loads the minimum fields from `pqr_submissions` / `pqr_events` server-side.

## 4. Required invariants

1. PQR mutation, history event, idempotency record and corresponding outbox event(s) commit or roll back together.
2. The worker commits a claim before any network request.
3. Every claim gets a fresh UUID lease token; finish/retry succeeds only for the current token.
4. An expired lease can be reclaimed; an old worker cannot overwrite the new worker's state.
5. A transient failure schedules bounded retry; attempts at the configured maximum move the event to `dead`.
6. The two initial emails are independent events. Delivery of one never marks the other as delivered.
7. The outbox event key is deterministic and unique for the logical email. Resend receives this same value as `Idempotency-Key`.
8. Do not claim global exactly-once delivery. The database can deduplicate logical events; provider idempotency reduces duplicate sends within its supported window, but a provider/network ambiguity beyond that window remains a residual risk.
9. No direct access for `anon` or `authenticated`; only server-side service role may call the RPC entry points.
10. Keep the existing rate-limit function and current Turnstile/origin/file validation defenses.

## 5. Request idempotency contract

The public form must generate one UUID when a user begins a submission attempt and preserve it through retries caused by timeout/network loss. The server:
- validates and canonicalizes the request;
- computes SHA-256 over the canonical payload (including attachment identity, not raw file bytes duplicated in the DB);
- inserts the request key and PQR row atomically;
- on same key + same fingerprint, returns the original reference and does not enqueue more email events;
- on same key + different fingerprint, returns HTTP 409;
- never trusts a client-provided fingerprint.

If the browser creates a new UUID on each retry, the system cannot recognize the retry. This requires a small frontend contract change and must be verified against the actual PQR form.

## 6. Status transitions: deliberately not hard-coded yet

The database currently permits five status values but does not define a business transition graph. The candidate must not invent a policy and silently block legitimate admin actions.

Before implementing `pqr_transition_submission`, confirm the permitted edges (including whether corrections/reopening are allowed) and then encode them as a strict allowlist. Until then, preserve the current UI behavior but do not claim optimistic concurrency is finished. The future RPC should lock the row, check expected status/version, write the new status, insert the event and enqueue any resulting notification atomically.

## 7. Resend behavior

The connected Resend tool schema exposes an `idempotencyKey` parameter that is sent as the `Idempotency-Key` header; Resend documents the same endpoint behavior. The worker must reuse the same event key for retries of the same logical email, and use a different key for a different event. Never mint a new key per network retry.

Provider-side idempotency has a finite retention window (confirm the current exact duration against Resend's current API docs before implementation). Therefore the worker still needs durable database state and a documented manual-retry policy for old ambiguous events.

## 8. Queue lease RPC draft

The SQL draft includes:
- `private.pqr_outbox` and `private.pqr_request_keys`;
- `public.pqr_outbox_claim` using `FOR UPDATE SKIP LOCKED`;
- `public.pqr_outbox_finish` fenced by lease token;
- `public.pqr_outbox_retry` fenced by lease token with max attempts.

All functions use `SECURITY INVOKER` and empty `search_path`. Execute is revoked from `PUBLIC`, `anon`, and `authenticated`, then granted to `service_role`. The private tables are not exposed to clients.

**Still missing before implementation:** atomic create/status/respond RPCs; request-key compare/replay; dead-letter admin retry with audit event; worker Edge Function; scheduling/cron invocation; Resend idempotency duration verification; PostgreSQL concurrency tests.

## 9. Test plan (must run on isolated PostgreSQL/Supabase branch)

- DDL applies cleanly on a clean isolated database and is idempotent only where explicitly designed.
- Unauthenticated and authenticated roles cannot select/insert/update outbox or request keys, nor execute RPCs.
- service_role can claim bounded batches; two concurrent claimers never receive the same live lease.
- Expired lease is reclaimable with a new token.
- Old token cannot finish or retry after a new claim.
- Duplicate request key + same fingerprint returns the same submission; different fingerprint returns conflict.
- Two initial notifications are separate; one provider failure does not alter the other.
- Retry backoff is bounded; max attempts moves to dead.
- Resend receives the stable event key on every retry.
- Crash simulation after provider acceptance but before DB finish demonstrates the provider idempotency boundary.
- PQR submission/status/response + event + outbox all roll back together on injected DB error.
- Attachment upload followed by DB failure is cleaned up through a compensating process.
- Existing rate limit, Turnstile, origin validation, file signature checks and admin allowlist remain intact.

## 10. Next implementation sequence

1. Confirm PQR form can retain a stable UUID per attempt.
2. Confirm status transition graph with product owner.
3. Reconcile the two deployed Edge Functions with the candidate source (already documented separately).
4. Complete atomic SQL RPCs and tests on an isolated branch.
5. Implement worker and Resend idempotency.
6. Integrate the admin retry action with audit.
7. Run security/performance advisors and inspect grants.
8. Review diff, then request separate approval before any production migration or deployment.

## 11. Verification status

- [x] Current Supabase docs reviewed for queues, function security and RPC access.
- [x] Project checked read-only for schemas and extension availability.
- [x] Candidate queue design mapped to deployed PQR schema.
- [x] SQL candidate drafted with lease fencing.
- [ ] SQL executed in isolated PostgreSQL.
- [ ] Concurrency and authorization tests passed.
- [ ] Worker implemented and tested.
- [ ] Frontend idempotency contract implemented.
- [ ] Business status graph approved.
- [ ] Production rollout approved.
