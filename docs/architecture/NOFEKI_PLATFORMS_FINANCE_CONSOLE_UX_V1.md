# NOFEKI Platforms — Finance Console UX v1

**Status:** UX specification only; not implemented.  
**Audience:** NOFEKI internal owner and authorized finance/commercial operators.  
**Design principle:** Premium, restrained and operationally clear.

## 1. Product shell

The finance console belongs inside internal NOFEKI Platforms administration, not the customer product launcher.

Target routes only:
- /platforms/admin/finance
- /platforms/admin/finance/customers/:organizationId
- /platforms/admin/finance/orders
- /platforms/admin/finance/subscriptions
- /platforms/admin/finance/payments
- /platforms/admin/finance/receivables
- /platforms/admin/finance/reconciliation
- /platforms/admin/finance/reports
- /platforms/admin/finance/audit

No router or page has been created.

## 2. Overview screen

Header:
- “Centro financiero”
- “Rendimiento comercial, caja y renovaciones de NOFEKI”
- As-of timestamp and data completeness.
- Global period, currency and product filters.

Primary KPI row:
1. MRR (run-rate)
2. Cash settled
3. Net cash after refunds and fees
4. Active paying organizations
5. Past-due subscriptions
6. Renewals next 30 days

Each KPI shows value, currency, comparison period, formula tooltip and drill-down. Trend appears only when data is sufficient.

Main layout:
- Main column: MRR movement bridge and cash collection trend.
- Side column: priority alerts and renewals needing attention.
- Lower: subscription status, plan mix, trial funnel and seat utilization.
- Bottom: recent commercial events and reconciliation exceptions.

Responsive:
- Desktop: KPI grid and two-column content.
- Tablet: wrapped KPIs; alerts remain prominent.
- Mobile: single column, filter drawer, stacked KPI cards and compact record lists.
- Status never relies on color alone.

## 3. Core list screens

### Customers & organizations
Columns: organization, owner/billing contact (limited), products/plans, subscription status, MRR, next renewal, seats licensed/assigned, latest activity, alert.

### Orders & checkout
Columns: order reference, organization, created date, plan/version, cadence, amount/currency, order status, payment status, provisioning status, owner/action. Abandoned checkout is a conversion signal, not a receivable.

### Subscriptions
Columns: organization, product/plan, cadence, recurring value, status, current period, paid-through, next renewal, masked provider/payment reference, license status.

Quick filters: trial, active, renewal soon, past due, grace, cancelled, expired, provisioning exception.

### Payments & cash
Columns: provider, transaction reference, order, organization, payment status, settlement date, gross, fee, refund/chargeback, net, reconciliation status.

Never display card PAN, CVV, bank credentials, provider secrets or raw sensitive payloads.

### Receivables
Only valid invoices/contractual obligations appear. Columns: document reference, organization, issue date, due date, original amount, paid, credits, open balance, days overdue, collection status. Failed renewals remain in a separate operational queue unless a valid receivable exists.

## 4. Organization commercial detail

Top summary: organization name/verification, owner, billing contact, commercial health, products/subscriptions, MRR and next renewal.

Tabs:
- Overview
- Orders
- Payments
- Invoices/documents
- Subscriptions
- Licenses & seats
- Events & audit

Timeline covers trial, order, payment, provisioning, renewal, refund, plan change and cancellation. Every amount links to its source record and currency.

## 5. Actions and guardrails

Low-risk: resend document link, resend billing notice, assign alert owner, add internal note.

Controlled: extend trial, schedule plan change, release seat, issue approved credit, request refund, retry reconciliation, cancel renewal. Require permission, reason, impact preview, confirmation and audit.

High-risk: execute refund, exceptional discount, write-off, manual license grant/revoke, billing-owner change, bulk correction. Require independent approval and dual control where policy applies.

No destructive one-click action. Confirmation shows target, current/resulting state, amount/currency, effective date, reason, approval and irreversible consequences. UI never claims success until server confirms.

## 6. Alerts and work queues

Each item shows severity, status, issue, organization/transaction, age, last attempt, owner, next step and open-case action.

Queues:
- Payment exceptions
- Paid but not provisioned
- Renewal failures
- Refund/chargeback reconciliation
- Invoice/document issues
- License-entitlement mismatch
- Past-due follow-up

Actions remain backend permission-scoped.

## 7. Empty, loading and degraded states

- No data: explain no transactions in selected period; no fabricated chart.
- Provider outage: show last successful sync and mark stale.
- Reconciliation incomplete: show data-incomplete warning and suppress misleading aggregates.
- Mixed currency: require currency filter or separate totals.
- No permission: explicit access-denied state, not empty dashboard.
- Backend unavailable: show last-known timestamp and stale label.

## 8. Accessibility and interaction

Keyboard navigation, visible focus, semantic headings/table headers, text status labels, accessible chart summaries/data tables, mobile touch targets, confirmation for financial actions, preserved filters, visible timezone/date boundaries and COP formatting with Colombian separators.

## 9. Visual direction

Use restrained NOFEKI Platforms surfaces, compact typography, clear hierarchy and whitespace. Accent color only for primary actions; warning/error colors only for real operational states. Charts explain, not decorate. Avoid oversized cards, gradients, excessive badges and decorative gauges.

## 10. V1 acceptance checklist

- Operator can distinguish MRR from settled cash.
- Every KPI has formula tooltip and drill-down.
- Billing operator can locate failed renewal and next action.
- Paid-but-not-provisioned order is prominent.
- Customer detail separates buyer, owner, billing contact and end users.
- Abandoned checkout never appears as receivable.
- Unauthorized user cannot see payment detail.
- Refund/credit/discount actions show impact, require reason and are audited.
- Currency/timezone are visible.
- Mobile core tasks work without horizontal scrolling.

**Implementation status:** UX only. No pages, components, routes, APIs or permissions implemented.
