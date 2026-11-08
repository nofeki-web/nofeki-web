# NOFEKI PQR — Transactional Outbox design

**Status:** design proposal only. No production schema, Edge Function, provider, or Supabase project has been changed.

## 1. Why an outbox is needed

PQR currently has database writes and email delivery as separate operations. A process can send an email and then fail before recording that it was sent, or commit a database change and fail before sending. Retrying the request can duplicate a message or leave a notification missing.

A transactional outbox closes the database-side gap: the PQR state change and the intent to notify are committed in the **same PostgreSQL transaction**. A separate worker delivers pending notifications.

It does not magically make email delivery exactly-once. If a provider accepts an email and the worker crashes before recording success, a retry may send it again. Provider-side idempotency (if supported) or a stable message key is needed to reduce that final ambiguity.

## 2. Proposed event flow

1. Edge Function validates the request, authenticates/authorizes the caller, and validates the PQR transition.
2. One database transaction updates the PQR record/history and inserts one or more outbox rows with deterministic event keys.
3. A worker claims due outbox rows with a short lease, using `FOR UPDATE SKIP LOCKED`.
4. The worker commits the claim, sends the email **outside** the database transaction, and then marks the row delivered.
5. On transient failure, it increments attempts and schedules exponential backoff with jitter; permanent failures go to `dead` for review.
6. A reconciliation view/report surfaces old pending rows, expired leases, and dead letters.

No email network call should occur while holding a PostgreSQL row lock or transaction open.

## 3. Suggested private table contract

Place the table in a non-exposed schema such as `private` (confirm current project schema conventions before implementation). Suggested fields:

| Field | Purpose |
|---|---|
| id UUID PK | Internal notification identifier |
| event_key TEXT UNIQUE | Deterministic dedupe key, e.g. `pqr:<submission_id>:<event_type>:<version>` |
| aggregate_id UUID | PQR submission ID |
| event_type TEXT | submitted, status_changed, response_added, etc. |
| payload JSONB | Minimal immutable delivery data; avoid unnecessary personal data |
| status TEXT | pending, processing, delivered, dead |
| attempts INT | Number of delivery attempts |
| available_at TIMESTAMPTZ | Earliest retry time |
| locked_until TIMESTAMPTZ | Lease expiry |
| lock_token UUID | Fencing token for current worker |
| delivered_at TIMESTAMPTZ | Successful provider acknowledgement time |
| last_error TEXT | Sanitized error only; never secrets or full message bodies |
| created_at / updated_at | Audit timestamps |

Indexes:
- unique index on `event_key`
- partial index on `available_at, created_at` for pending rows
- partial index on `locked_until` for processing rows

RLS and grants must follow the actual Supabase access model. The outbox should not be exposed through the Data API to `anon` or `authenticated`. Only a narrowly scoped backend role/function should be able to read/claim/update it. Avoid a broadly callable `SECURITY DEFINER` function; if one is genuinely required, keep it in a private schema, verify caller authorization, restrict EXECUTE grants, and run Supabase security advisors.

## 4. Atomic write contract

A PQR mutation RPC should perform all database-side effects in one transaction:

- lock/check the target submission and validate expected current status/version
- apply the new status or response
- insert the corresponding immutable history/event row
- insert the outbox event using `INSERT ... ON CONFLICT (event_key) DO NOTHING`
- return the persisted PQR state and event identifier

If any database step fails, the entire transaction rolls back. Email delivery is not part of this transaction.

Do not use a generic client-supplied event key without binding it to the authenticated submission and operation. The backend should derive the key from trusted identifiers and a monotonic version/event ID.

## 5. Worker contract

**Claim phase (short transaction):**
- select due `pending` rows, plus expired `processing` leases
- order by `available_at, created_at`
- use `FOR UPDATE SKIP LOCKED`
- set `status='processing'`, `locked_until=now()+lease`, and a fresh random `lock_token`
- commit and return claimed payloads

**Delivery phase (outside transaction):**
- send using a stable provider idempotency key derived from `event_key`, if the email provider supports it
- never log recipient credentials, access tokens, full sensitive payloads, or provider secrets

**Finalize phase:**
- mark delivered only where `id`, `status='processing'`, and `lock_token` still match
- on transient error, return to pending with bounded exponential backoff and jitter
- on permanent error or exhausted attempts, mark dead and surface for operator review

The lock token is a fencing mechanism: an expired worker must not overwrite the state written by a newer worker.

## 6. Retry policy proposal

- Initial delay: 30 seconds
- Exponential growth, capped at 6 hours
- Add random jitter to avoid synchronized retry bursts
- Maximum attempts: 8 (configurable after observing provider behavior)
- Treat provider rate limits and 5xx/network errors as transient
- Treat invalid recipient/address and hard policy rejection as permanent unless corrected
- Dead-letter rows are not silently discarded; expose count, age, event key, and sanitized error to authorized administrators

## 7. Idempotency boundaries

There are three separate idempotency boundaries:

1. **Inbound PQR request:** unique client/request idempotency key plus request fingerprint prevents duplicate submissions.
2. **Database event creation:** unique deterministic `event_key` prevents duplicate outbox intents when a mutation is retried.
3. **Email provider delivery:** provider idempotency key (if available) reduces duplicates after an ambiguous timeout/crash.

Only the first two are enforceable entirely inside PostgreSQL. Exactly-once email delivery cannot be guaranteed by a database transaction alone.

## 8. Required test cases before implementation

| Scenario | Expected result |
|---|---|
| Same submission request retried | One PQR submission |
| Same status transition retried | One history event and one outbox event |
| Concurrent identical transition | One wins; other receives duplicate/current-state result |
| Transaction fails after status update but before outbox insert | Entire transaction rolls back |
| Two workers claim concurrently | A row is leased to only one worker at a time |
| Worker lease expires | Another worker can reclaim |
| Old worker finalizes after lease was reclaimed | Fencing token rejects stale update |
| Provider transient error | Retry scheduled; attempt count increments |
| Provider permanent error | Dead-letter state and admin visibility |
| Provider accepts, worker crashes before finalize | Retry occurs; provider idempotency key is used if supported; duplicate risk documented otherwise |
| Event is already delivered | No second send attempt |
| Sensitive payload | Minimized and sanitized; no secrets in logs |

## 9. Rollout plan (not authorized/executed)

1. Inspect current production schema/functions and exact email provider capabilities.
2. Confirm provider idempotency support and key retention window.
3. Build isolated PostgreSQL integration tests and run concurrency/failure injection.
4. Implement private schema, RLS/grants, mutation RPCs, and worker on a separate test branch/project.
5. Run security advisors and test PQR submission, admin response, retry, status update, and duplicate scenarios.
6. Only after explicit approval, prepare migration/PR and deployment plan. Do not directly apply this design to production.

## 10. Current limitation

This is a design contract, not an executable migration. No production changes were made. PostgreSQL integration and provider behavior have not been verified in this environment.