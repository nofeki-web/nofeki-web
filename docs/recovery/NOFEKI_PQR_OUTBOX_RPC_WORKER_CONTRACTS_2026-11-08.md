# NOFEKI PQR — Transactional Outbox RPC and worker contracts

**Design only.** These are interface contracts for a future isolated implementation, not SQL migrations or callable production endpoints.

## Database mutation RPCs

### `private.pqr_apply_status_transition`

Input:
- `p_submission_id UUID`
- `p_expected_status TEXT`
- `p_new_status TEXT`
- `p_actor_id UUID` (must be derived/validated by trusted backend context; do not trust arbitrary client identity)
- `p_transition_request_id UUID` (stable retry identifier)

Atomic responsibilities:
1. Verify caller authorization and allowed transition.
2. Lock submission row and compare expected state/version.
3. Detect prior transition request ID.
4. Update submission status/version.
5. Insert exactly one history event.
6. Insert one outbox row with deterministic `event_key`.
7. Return submission ID, resulting status/version, event ID, and whether the request was replayed.

### `private.pqr_record_admin_response`

Input:
- submission ID
- stable response request ID
- response text / approved response metadata
- validated admin actor identity

Atomic responsibilities: authorize admin, dedupe response request, persist response/history, insert notification outbox event, return persisted identifiers. No email send inside this RPC.

### `private.pqr_create_submission`

Input includes a stable inbound idempotency key and request fingerprint. It must atomically create submission, initial history, and notification outbox event. A repeated key with same fingerprint returns original submission; same key with different fingerprint returns conflict.

## Worker interfaces

### Claim

Returns a bounded batch of events with:
- outbox ID
- event key
- event type
- minimal immutable payload
- fresh lock token
- lease expiry

Claim must use `SKIP LOCKED`, have a bounded batch size, and commit before network calls.

### Finalize success

Input: outbox ID, lock token, provider message ID, provider acknowledgement timestamp.

Update only if the row remains processing and the lock token matches. If no row matches, report stale lease; do not overwrite newer state.

### Schedule retry

Input: outbox ID, lock token, sanitized error class/message, next available time.

Update only if the lease token matches. Never store provider secrets or full sensitive message bodies.

### Mark dead

Input: outbox ID, lock token, sanitized terminal error.

Only the current lease holder may mark the event dead. An authorized admin retry should explicitly move it to pending and record the operator action.

## Authorization and exposure

- Keep outbox tables and worker functions in a private, non-exposed schema.
- Do not grant direct table access to `anon` or `authenticated`.
- Worker credentials remain server-side; never put service-role keys in browser code or Shortcut configuration.
- Validate admin authorization server-side, not from user-editable metadata.
- Prefer invoker rights. If a definer function is unavoidable, restrict schema, owner, search_path, EXECUTE grants, and enforce authorization inside it.
- Review RLS/grants and run Supabase security advisors before any rollout.

## Required observable metrics

- pending count and oldest pending age
- processing count and expired lease count
- delivered count
- dead count and oldest dead age
- attempts histogram
- provider rate-limit / 5xx / hard-failure counts
- duplicate request/event suppression counts

No PII should be included in metrics labels.