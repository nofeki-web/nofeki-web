# NOFEKI Platforms — Executive Control Center UX v1

**Status:** UX specification only; not implemented.  
**Audience:** NOFEKI owner and explicitly authorized executive users.

## 1. Shell and navigation

Target route: /platforms/admin/executive

Sections: Overview, Portfolio, Growth, Access & licenses, Commercial, Platform health, Security & risk, Decisions, Reports.

This is an internal workspace, separate from customer portal/product launcher. It links to admin and finance consoles for detailed work.

## 2. Overview layout

**Global header**
- “Control ejecutivo”
- “Visión integral del ecosistema NOFEKI”
- Overall domain state and last refresh.
- Reporting period and currency context.
- User role and access scope.

**First row — ecosystem snapshot**
- Registered users
- Active organizations
- Active products
- Paying organizations
- MRR (run-rate)
- Cash settled

Every tile includes definition, as-of time and click-through. Commercial tiles reuse Finance KPI definitions.

**Second row — adoption and operations**
- Active users by product
- Organization adoption by product
- Product activation/first-value funnel
- Seat utilization
- Trial-to-paid conversion
- Paid-but-not-provisioned queue

Activation/first-value metrics appear only after agreed event definitions and instrumentation.

**Third row — health and risk**
- Product availability/status with source freshness
- Critical/high incidents
- Authentication/access anomalies
- Webhook/reconciliation exceptions
- Upcoming renewals and past-due subscriptions
- Pending approvals and overdue decisions

**Bottom — portfolio and decision feed**
- Gastos, OPS and future product cards.
- Product lifecycle changes/releases where available.
- Executive decision log.
- Recent escalations and incident timeline.

## 3. Portfolio page

Product cards show name/key, lifecycle (concept/private beta/trial/GA/maintenance/retired), customer availability and internal health separately, owner, active organizations/users, pricing model, catalog version, incidents, adoption trend, data freshness and link to product operations.

A catalog entry alone does not mean the product is available.

## 4. Customer growth page

Summary: new users/orgs, verified organizations, active organizations by product, activation rate, trial cohorts/conversion, cross-product adoption, churn/reactivation and support escalations.

Charts: user/org growth, adoption mix, activation funnel, cohort conversion and retention. Drill-down opens authorized organization record only; never show customer expense or inventory content.

## 5. Access and licensing page

Aggregate metrics: canonical identities, active memberships, privileged internal accounts by role, licenses by product/status, seats licensed/assigned/available, module utilization, trials/expirations, orphaned assignments, mismatches and access-denial trend by reason.

High-risk changes route to controlled admin workflow. No direct grant/revoke on overview.

## 6. Commercial page

Read-only summary: MRR/ARR, cash settled/net cash, paying organizations, renewal forecast, past-due subscriptions, validated receivables, payment success/recovery, plan mix/discounts and provisioning exceptions.

Link to Finance Console for records, definitions and authorized actions.

## 7. Platform health page

Cards for portal/product entry points, identity, APIs/functions, database indicators, payment/webhooks, scheduled jobs, notifications and dependencies.

Each status includes state (healthy/degraded/incident/unknown), last check, source, duration, impact and measured/manual indicator. No SLA/uptime claim without approved window and monitoring coverage.

## 8. Security and risk page

Show counts/trends, not raw sensitive records: critical/high incidents, privileged role changes, pending dual approvals, authorization-denial spikes, license mismatches, suspicious webhook alerts and overdue privacy/security actions.

Sensitive details require separate permission and audited drill-down.

## 9. Decisions and escalations

Decision fields: ID, title, domain, recommendation, owner, approver, impact, due/review date, status and evidence.

Escalation card: severity, domain, impact, affected product/organization (minimal identifier), age, owner, next action and linked workspace.

Quick actions: acknowledge, assign/escalate, open source workspace, approve only explicitly authorized request, record decision. No direct destructive production action.

## 10. Responsive behavior

- Desktop: multi-column dashboard with persistent alert rail.
- Tablet: two-column KPI grid and stacked analytics.
- Mobile: one-column cards, collapsible filters, compact status lists; no horizontal scrolling for priority actions.
- Critical alerts above secondary analytics.
- Status uses text/icon, not color alone.

## 11. States and trust cues

- Loading: skeleton with source labels.
- Empty: explain no data/events; no fabricated values.
- Stale: last successful refresh and warning.
- Partial outage: show domain failure; preserve unaffected sections.
- Unauthorized: explicit access denied, not empty.
- Incomplete instrumentation: “Not instrumented”, not zero.
- Aggregates link to definition and source domain.

## 12. V1 acceptance checklist

- Owner distinguishes registered users from active users.
- Product availability differs from internal health.
- MRR visually distinct from cash settled.
- Every domain shows freshness.
- No customer product transaction content appears.
- Critical alert can be acknowledged/assigned without bypassing authorization.
- High-risk actions route to approved workflow.
- No global healthy state masks a failed data source.
- Mobile overview surfaces critical risks first.
- Gastos direct access unaffected by executive console outage.

**Implementation status:** UX only. No UI, routes, APIs or permissions have been created.
