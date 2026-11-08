# NOFEKI Platforms — Executive Control Center v1

**Status:** Executive product and operating model; not implemented.  
**Audience:** NOFEKI platform owner and explicitly authorized executive operators.  
**Scope:** Cross-ecosystem oversight for identity, customers, organizations, product portfolio, access/licensing, commercial performance, platform operations and risk.  
**Safety:** No production database, Auth, RLS, Edge Functions, payment provider, Vercel, deployment or customer data has been changed.

## 1. Purpose and position in the ecosystem

The Executive Control Center is the owner-level view of NOFEKI Platforms. It sits above the customer portal, product workspaces, internal admin console and finance console.

It does not replace those workspaces:
- **Customer portal:** customers see their own profile, organizations, products, seats, licenses and billing actions.
- **Product workspaces:** users perform their work in Gastos, OPS and future products.
- **Internal admin console:** authorized operators manage platform users, organizations, catalog, access and support.
- **Finance console:** billing operators manage orders, payments, renewals, reconciliation and finance reporting.
- **Executive Control Center:** owner-level oversight, portfolio health, strategic KPIs, risk and escalations across the ecosystem.

It answers: Is the ecosystem healthy? Are customers activating and receiving value? Which products are growing? Are licenses correct? Is recurring business sustainable? What needs executive attention? Which decisions threaten customers, cash, security or reputation?

## 2. Design principles

- One overview with links to source workspaces; avoid duplicate workflows.
- Explicit role-aware access; never infer privilege from email or route.
- Least privilege: executive visibility does not automatically authorize billing, security or production mutations.
- Data minimization: aggregate operational signals; exclude customer expense, inventory and sensitive content.
- Evidence over decoration: every KPI has definition, timestamp, source and drill-down.
- Truthful status: distinguish live, delayed, stale, unavailable, estimated and incomplete.
- No silent mutations: consequential actions require permission, reason and audit.
- Product independence: portal failure must not disable an approved direct product access path.
- Reversible rollout with read-only launch, feature flags and rollback.

## 3. Executive navigation

1. Overview
2. Portfolio
3. Customers & growth
4. Access & licensing
5. Commercial performance
6. Platform health
7. Security & risk
8. Decisions & escalations
9. Reports

The executive console links to detailed admin/finance pages rather than embedding every administrative capability.

## 4. Overview dashboard

### Executive status header
Show overall platform status (Healthy / Degraded / Incident / Unknown), last refresh and freshness per domain, active product count, products with incidents, open critical/high escalations, reporting period and currency context.

Never show one global green status if a data source is unavailable. Show domain-level freshness.

### KPI groups

**Ecosystem**
- Registered users: distinct canonical Auth identities.
- Monthly active users by product and unique cross-product users, with definitions.
- Active organizations.
- Active products and released modules.
- New users and organizations in period.

**Adoption**
- Product activation and first-value completion, only with reliable event definitions.
- Active organizations by product.
- Seats assigned / licensed.
- Trial starts and matured trial-to-paid conversion.
- Cross-product adoption (organizations using at least two products).

**Commercial**
- MRR and ARR run-rate.
- Cash settled and net cash, separately.
- Paying organizations.
- Upcoming renewals and past-due subscriptions.
- Plan mix and expansion/contraction/churn movements.
- Paid orders awaiting provisioning.

Reuse Finance Console KPI definitions. Do not relabel MRR as revenue or cash.

**Platform health**
- Product availability and synthetic-check status.
- API/error rate and latency percentiles where instrumentation exists.
- Authentication and authorization failures.
- Server function/job queue health where applicable.
- Webhook backlog and dead-letter counts.
- Provisioning success and payment-to-activation time.
- Data freshness and reconciliation completion.

Uninstrumented metrics must say “Not instrumented”, not show inferred values.

**Security and risk**
- Open critical/high incidents.
- Privileged role changes and pending approvals.
- Access-denial spikes.
- License/entitlement mismatches.
- Suspicious webhook/replay events.
- Overdue privacy/security actions if those workflows exist.

Never expose secret values, raw tokens, full payment payloads or personal financial records.

### Executive alert and decision queue

Each item has severity, domain, affected product/organization (minimal identifiers), customer/business impact, detected and updated timestamps, freshness, owner, next action, evidence, state (new, acknowledged, investigating, mitigated, resolved, accepted-risk), and resolution details.

Overview actions are limited to acknowledge, assign/escalate, open source workspace, approve a specifically authorized request, or record a decision. No destructive production controls on the overview.

## 5. Portfolio management

Each product entry shows product key/name, lifecycle (concept, private beta, trial, generally available, maintenance, retired), customer availability, internal health, owner, active organizations/users, pricing model, plan catalog reference, adoption trend, incidents, release metadata and dependencies.

Initial portfolio:
- **NOFEKI Gastos:** free personal product; existing direct access must remain functional during Platforms migration.
- **NOFEKI OPS:** paid/licensable organization product; plans, seats, warehouses and modules follow approved catalog.
- **Future products:** remain roadmap/private until explicitly released.

Catalog presence alone does not mean generally available.

## 6. Customer and organization growth

Aggregated view: registered/verified organizations, new organizations, active/inactive, product adoption, paid/trial/free status, churn/reactivation, onboarding/first-value completion and support escalation volume/resolution time.

Drill-down opens authorized organization 360. Never expose Gastos transaction details, OPS stock records or unrelated customer product content.

## 7. Identity, access and licensing oversight

Show aggregate counts and exceptions: canonical identities, organizations/memberships, privileged internal roles, active licenses by product/plan, seat capacity/assignments, module entitlements, trials/expirations, orphaned assignments, entitlement mismatches and access-denial categories.

Grant/revoke, ownership transfer and privileged-role changes route to controlled admin workflows. Dashboard visibility is not authorization to perform the action.

## 8. Commercial oversight

Read-only summary from Finance Console: MRR/ARR, settled/net cash, paying organizations, renewal forecast, past-due subscriptions and validated receivables separately, payment failure/recovery, trial conversion, plan mix and paid-but-not-provisioned exceptions.

Finance Console remains source of truth for definitions, transactions, reconciliation and financial mutations.

## 9. Platform health and incident management

Domain panels: portal/product entry points, identity/Auth, APIs/server functions, database indicators where authorized, payment/webhooks, scheduled jobs/reconciliation, email/notifications and external dependencies.

Every signal shows source, last check, threshold, duration, impact and whether measured or manually reported. Do not claim uptime/SLA compliance without an approved measurement window and monitoring coverage.

Incident lifecycle: detect, classify severity/scope, assign incident owner, record impact, mitigate via approved runbook, communicate, verify recovery, complete post-incident review and assign follow-up actions.

The console coordinates incidents; remediation occurs through approved runbooks and systems.

## 10. Security, privacy and governance

- Server-side authorization for every query/action.
- Separate executive read permissions from billing, support, product and infrastructure mutation permissions.
- MFA/strong authentication for privileged internal roles is a future implementation gate; no Auth changes in this design phase.
- Dual control for high-risk role, license, refund and platform-wide changes.
- Audit sensitive report access and all privileged actions.
- Redact personal data unless needed for a specific authorized task.
- No customer impersonation in v1.
- No raw secrets, password material, card data, tokens or customer financial transaction content.
- Retention, data-subject request and incident notification policies require legal review.

## 11. Executive decision register

Structured decision log fields: decision ID/title, domain/product, problem/opportunity, options, recommendation, decision owner/approver, financial/customer/security impact, dependencies/risks, decision/review dates, implementation owner/status and evidence.

Examples: approve public OPS pricing, select payment provider, authorize product launch, approve refund threshold, accept documented risk, authorize migration gate. A decision record does not replace technical authorization.

## 12. Executive reporting cadence

- Daily: critical incidents, paid-but-not-provisioned, failed renewals, access/licensing anomalies.
- Weekly: new users/orgs, activation, trials, conversion, product adoption and escalations.
- Monthly: MRR/ARR bridge, cash settlement, churn/retention, plan mix, unit economics, reliability and security.
- Quarterly: portfolio, pricing, roadmap investment, customer segments, risk register and strategic decisions.

Reports state period, definitions, sources, freshness, exclusions and completeness. Scheduled delivery is a later feature requiring recipient permissions and retention approval.

## 13. Source-of-truth boundaries

| Domain | Source of truth | Executive projection |
|---|---|---|
| Identity | Auth identity + approved profile domain | Counts/minimal profile state |
| Organizations | Organization/membership domain | Counts, adoption, exceptions |
| Product catalog | Versioned product/module catalog | Lifecycle/release status |
| Access | Server-side roles/permissions/entitlements | Counts, utilization, mismatches |
| Billing | Orders/subscriptions/payment ledger | MRR, cash, renewals, exceptions |
| Product usage | Product-specific event contracts | Aggregated activation/adoption |
| Platform health | Monitoring/incident sources | Status, freshness, incident count |
| Security/audit | Security events and audit log | Risk summaries, privileged activity |

No new source of truth is created by this dashboard. Read through authorized domain APIs or access-controlled aggregates. Never query product tables directly from a browser.

## 14. Delivery phases

- **Phase 0 — Instrumentation/definitions:** approve metric contracts, event schemas, source owners, privacy classification, thresholds and freshness targets.
- **Phase 1 — Read-only shell:** portfolio metadata and domain freshness; no mutation actions.
- **Phase 2 — Aggregated live data:** identity/org/product/access and finance read models with server-side authorization and tenant-isolation tests.
- **Phase 3 — Health/incident signals:** connect monitoring, reconciliation and alert queues; document coverage gaps.
- **Phase 4 — Decisions/approvals:** only approved actions with independent authorization, audit and dual control.
- **Phase 5 — Scheduled reporting:** permission-scoped distribution and retention.

Every phase requires isolated tests, security review, rollout/rollback plan and explicit approval. Direct Gastos access remains independent.

## 15. V1 exclusions

No customer product data viewer, customer impersonation, direct database console, raw secrets, arbitrary production controls, automated remediation, accounting ledger, tax filing, speculative AI scores, unverified uptime claims or scheduled reports before access/retention policy.

## 16. Open decisions

1. Which roles see full executive overview vs product summaries?
2. Canonical definitions of active user, active organization and product activation?
3. Monitoring provider/source for availability, latency and errors?
4. Shared event taxonomy across products?
5. Freshness targets by dashboard domain?
6. Severity thresholds and escalation SLAs?
7. Incident commander and backup?
8. Export permissions and scope?
9. Retention for executive reports and decision records?
10. Security controls, including MFA, required before admin launch?

**Implementation status:** Architecture only. No routes, APIs, schema, monitoring integration, permissions or dashboard have been implemented.
