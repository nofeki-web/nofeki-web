# NOFEKI Platforms — Executive Metrics & Event Contract v1

**Status:** Proposed metric/event contract; not implemented.

## 1. Purpose

The executive dashboard must not invent metrics by counting arbitrary rows. Each product/domain publishes versioned, privacy-reviewed events or read-model aggregates. A metric without a trusted definition/source is “not instrumented”.

## 2. Metric definitions

| Metric | Proposed definition | Notes |
|---|---|---|
| Registered users | Distinct canonical Auth user UUIDs | Not active users |
| Active users (period) | Distinct users with qualifying authenticated product action in period | Exclude background refresh |
| Active organizations | Active organizations with at least one active membership | Report total and per product |
| New organizations | First verified organization activation in period | Exclude draft/pending |
| Product activation | User/org completes product-specific first-value milestone | Define per product |
| Product adoption | Active organizations using product / eligible active organizations | Publish denominator |
| Cross-product adoption | Active organizations with qualifying activity in at least two products | Catalog visibility is not usage |
| Licensed seats | Active seat capacity purchased/granted | Product/plan scope |
| Seat utilization | Active assigned seats / licensed capacity | Align with entitlement policy |
| Trial conversion | Matured eligible trial cohort converted within approved window | Reuse finance dictionary |
| Paying organizations | Organizations with at least one active paid subscription | Exclude free/trial-only |
| MRR/ARR | Reuse Finance KPI Dictionary | Never recompute independently |
| Cash settled | Reuse Finance KPI Dictionary | Not MRR |
| Product availability | Successful authorized synthetic check / eligible checks in approved window | Monitoring required |
| Error rate | Eligible failed server requests / total eligible requests | Define exclusions/sampling |
| Latency | p50/p95/p99 for named request classes | Include window/sample count |
| Provisioning success | Completed eligible paid/trial provisioning / eligible requests | Reuse commercial event contract |
| Data freshness | Current time minus source's latest successful update | Show per domain |

## 3. Event envelope

Each cross-platform event includes:
- event ID (unique immutable);
- event name and schema version;
- occurred-at and received-at UTC timestamps;
- source product and source service;
- actor type (user, organization, system, provider);
- pseudonymous actor ID where needed;
- optional organization/product context;
- correlation ID and optional causation ID;
- environment (production, staging, sandbox);
- data classification and retention category.

Payloads are allowlisted, minimized and schema-validated. Do not include expense amounts/categories, inventory item details, full emails, access tokens, card/payment credentials, free-form support text or customer content in shared analytics events.

## 4. Recommended event taxonomy

**Identity and organizations**
- identity.registered
- identity.verified
- identity.signed_in (aggregate/limited; no raw session secrets)
- organization.created
- organization.verified
- organization.membership_activated
- organization.membership_revoked

**Product lifecycle**
- product.published
- product.suspended
- product.retired
- product.module_enabled
- product.module_disabled
- product.release_completed

**Product adoption**
- product.first_value_completed
- product.active_usage_recorded (aggregated where possible)
- product.seat_assigned
- product.seat_released

**Commercial**
Reference the existing commercial event contract for orders, payments, subscriptions, trials, licenses and provisioning. Do not create a second source of truth.

**Platform health**
- health.synthetic_check_completed
- health.incident_opened
- health.incident_acknowledged
- health.incident_mitigated
- health.incident_resolved
- health.reconciliation_failed
- health.queue_backlog_threshold_breached

**Security and governance**
- security.authorization_denied (stable reason code; no token/body)
- security.privileged_action_requested
- security.privileged_action_approved
- security.privileged_action_rejected
- security.policy_violation_detected
- governance.decision_recorded

## 5. Privacy and access

- Analytics events are not a mechanism to replicate product databases.
- Prefer aggregates or pseudonymous IDs with access-controlled mapping.
- Separate product telemetry from billing/identity records.
- Apply purpose-specific retention/deletion rules.
- Executives default to aggregates; event-level access is restricted.
- Apply organization boundaries to drill-down.
- Never include credentials, full payment details, customer expense/inventory data or sensitive personal data.
- Audit event access and exports.

## 6. Quality and reliability

- Idempotency by event ID.
- Schema versioning and compatibility policy.
- Bounded retry and dead-letter handling.
- Explicit late/out-of-order event handling.
- Environment separation; sandbox never enters production KPIs.
- Measure event loss/lag.
- Label and audit backfills.
- Data quality failure marks metrics incomplete, not zero.
- Record source-of-truth owner for each metric.

## 7. Proposed freshness targets — not committed SLOs

- Identity/org/access summary: within 5 minutes.
- Commercial payment/provisioning exceptions: within 5 minutes.
- Cash settlement/reconciliation: daily or provider-settlement cadence.
- Product adoption: within 1 hour.
- Portfolio/release metadata: within 15 minutes.
- Critical health/incident signals: within 1 minute where monitoring exists.

These are design hypotheses, not commitments. Show measured freshness, never imply a target is met without evidence.

## 8. Metric ownership

- Identity/organization: Platforms domain owner.
- Product adoption: product owner.
- Commercial: finance/billing owner using finance KPI dictionary.
- Health: engineering/operations owner.
- Security: security owner.
- Executive reporting: platform owner approves definitions/publication.

## 9. Acceptance tests

1. Duplicate event does not double-count users, activation or commercial value.
2. Sandbox event never enters production KPI.
3. Late/out-of-order event reconciles without corrupting history.
4. Unknown schema version is quarantined and metric marked incomplete.
5. Product event cannot include customer expense/inventory content.
6. Active-user calculation excludes background refresh/passive heartbeat.
7. Cross-product adoption counts qualifying product activity only.
8. Dashboard says “not instrumented” for missing sources.
9. Every KPI maps to owner, definition, source and freshness.
10. Unauthorized users cannot query event-level or organization-level detail.

**Implementation status:** Contract proposal only. No telemetry, event pipeline, data store or dashboard implemented.
