# NOFEKI PQR — Outbox fault-injection matrix

**Scope:** design/test specification for an isolated implementation. No production changes.

| ID | Injected condition | Expected invariant | Evidence required |
|---|---|---|---|
| OX-01 | Same event inserted twice | One outbox row per deterministic event key | Unique constraint + count=1 |
| OX-02 | Two workers claim same pending row | Only one active lease | Two DB sessions; one claim succeeds |
| OX-03 | Worker crashes after claim | Lease eventually expires and event is reclaimable | Timestamp/lease test |
| OX-04 | Old worker finalizes after reclaim | Stale lock token cannot mutate row | Update affects zero rows |
| OX-05 | Provider returns 429/5xx/timeout | Retry with bounded backoff and jitter | attempts++, available_at future |
| OX-06 | Provider rejects permanently | Event enters dead-letter state | status=dead and sanitized error |
| OX-07 | Provider accepts, worker crashes before DB ack | Retry is possible; duplicate risk remains unless provider dedupes | Provider idempotency key / message trace |
| OX-08 | Delivered event polled again | No second delivery | delivered row is not claimable |
| OX-09 | Invalid/forged lock token | No state mutation | update affects zero rows |
| OX-10 | Batch claim with multiple workers | No overlapping leases; no starvation | Concurrent DB integration test |
| OX-11 | Mutation transaction fails before commit | PQR update/history/outbox all roll back | Inject exception before commit |
| OX-12 | Duplicate inbound request key, same fingerprint | Return original result; no second submission/event | DB integration test |
| OX-13 | Duplicate inbound request key, different fingerprint | Conflict; no mutation | DB integration test |
| OX-14 | Admin retries dead letter | Audited operator action; event returns to pending once | Admin audit event |
| OX-15 | Sensitive provider error | No secret/token/full payload in logs | Log inspection |

## Retry/backoff acceptance

Proposed policy to validate with actual provider:
- exponential backoff, capped at 6 hours, with jitter
- maximum 8 attempts, then dead-letter
- 429, network timeout, and provider 5xx are transient
- hard invalid-recipient/policy errors are permanent
- persist provider message ID on acknowledgement
- keep error data sanitized and bounded

Do not hardcode this policy until provider rate limits, retry semantics, and operational volume are confirmed.

## Observability acceptance

A test deployment must expose authorized operator metrics:
- pending count and oldest pending age
- processing count and expired leases
- delivered count
- dead-letter count and oldest dead age
- attempt distribution
- transient/permanent provider failures
- duplicate request/event suppression counts

No email addresses, submission text, tokens, or other PII in metric labels.

## Exit criteria

Implementation is not ready for production until:
1. PostgreSQL integration tests pass with at least two concurrent sessions.
2. Failure injection covers all rows above.
3. Provider idempotency behavior is verified from provider documentation or test account.
4. RLS/grants/security advisors are reviewed.
5. Restore and rollback procedures are tested.
6. User explicitly approves a production change plan.

