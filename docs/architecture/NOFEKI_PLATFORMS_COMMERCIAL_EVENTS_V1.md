# NOFEKI Platforms — Commercial Events & Reconciliation Contract v1

**Status:** Proposed event catalog; no handlers implemented.

## 1. Processing contract

Every external or internal commercial event must have:
- unique event ID and source/provider;
- event type and schema version;
- occurred-at and received-at timestamps in UTC;
- correlation ID and optional causation ID;
- target order/subscription/license identifiers;
- verification status and processing status;
- bounded retry count and next retry time.

Persist event identity before side effects. Enforce a unique key on `(source, external_event_id)`. Process transitions transactionally or through a transactional outbox. Do not trust event payload order; reconcile with authoritative provider state when needed.

## 2. Event catalog

| Event | Expected effect | Guard |
|---|---|---|
| `checkout.created` | Order becomes pending checkout | Internal order exists |
| `payment.pending` | Record pending attempt | Match order, amount, currency |
| `payment.succeeded` | Mark verified paid; enqueue provisioning | Verified provider signature/state |
| `payment.failed` | Record failure; keep no paid entitlement | Match attempt; event is current |
| `payment.refunded` | Record refund; apply approved access policy | Refund verified and reconciled |
| `subscription.created` | Create subscription record | Customer/order mapping verified |
| `subscription.renewed` | Extend period and license | Payment settled and period valid |
| `subscription.payment_failed` | Move to past_due/grace | Subscription mapping verified |
| `subscription.cancel_scheduled` | Record end-of-period cancellation | Authorized actor/provider |
| `subscription.cancelled` | End access at effective date | Effective timestamp validated |
| `subscription.reactivated` | Restore eligible access | Verified payment/reactivation |
| `license.provision.requested` | Create/update license idempotently | Paid/trial/approved zero-cost order |
| `license.provisioned` | Mark order fulfilled | License and entitlements committed |
| `license.provision.failed` | Queue retry and alert operations | Retry budget and dead-letter policy |
| `seat.assigned` | Assign user seat | Active membership and capacity |
| `seat.released` | Release seat | Authorized actor and assignment exists |
| `entitlement.changed` | Update product access resolution | Approved plan/license transition |

## 3. Idempotency rules

- Provider event: unique by provider + external event ID.
- Checkout: client retries reuse the same internal idempotency key; server verifies payload equivalence.
- Payment: one authoritative successful payment per payable order unless split/partial payment is explicitly supported.
- Provisioning: unique license effect for order item + plan version + scope.
- Seat assignment: prevent duplicate active assignment for the same license and user.
- Notifications: deduplicate by event + recipient + template version.
- Refund: never execute twice for the same refund instruction/reference.

An idempotency conflict with different amount, currency, target, or payload hash must fail closed and raise an operational alert.

## 4. Reconciliation jobs

Scheduled reconciliation should compare:
1. internal pending payment attempts against provider authoritative state;
2. paid orders against fulfilled license/provisioning state;
3. active subscriptions against current paid-through periods;
4. license capacity against active seat assignments;
5. provider refunds/credits against internal billing adjustments;
6. unprocessed/failed events against retry and dead-letter queues.

Reconciliation must be read-first. Any corrective mutation records source evidence, before/after state, actor or automated job identity, and reason. Large-scale corrections require human review.

## 5. Failure handling

- Signature invalid: reject, log sanitized metadata, no state mutation.
- Duplicate event: acknowledge safely; no duplicate side effect.
- Unknown order/customer mapping: quarantine and alert; do not guess.
- Out-of-order event: fetch authoritative state or defer; do not blindly roll back a newer state.
- Provider timeout: keep pending and retry with bounded exponential backoff.
- Provisioning failure after payment: keep paid-pending-provisioning, retry, and escalate; never initiate a second charge automatically.
- Exhausted retries: dead-letter with operator workflow; preserve original event and full traceability.
- Email delivery failure: retry separately; never reverse commercial state.

## 6. Security and privacy

- Verify provider signatures using server-held secrets.
- Enforce timestamp/replay windows where supported.
- Never log raw card data, provider secrets, access tokens, or full webhook payloads if they contain personal/payment data.
- Restrict raw event payload access to a narrow operational role; default views show redacted fields.
- Protect webhook endpoints with rate limits and request-size limits.
- Keep provider test and production credentials separate.
- Rotate compromised webhook secrets through a documented process.

## 7. Required tests

- Valid, invalid, expired, replayed, duplicate, and out-of-order webhook.
- Correct and mismatched order, amount, currency, and customer references.
- Concurrent checkout retries.
- Payment success followed by provisioning timeout.
- Subscription renewal after cancellation request.
- Refund event after renewal event.
- Duplicate seat assignment under concurrent requests.
- License expiry while user has an existing session.
- Dead-letter retry and manual reconciliation with approval.
