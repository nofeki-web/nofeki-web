# NOFEKI Platforms — Finance & Revenue Console v1

**Status:** Product/operating design only; not implemented.  
**Scope:** Internal financial and commercial control plane for NOFEKI SaaS.  
**Currency baseline:** COP, with currency-separated reporting.  
**Safety:** No production database, payment provider, Auth, RLS, Edge Function, Vercel configuration, or deployment has been changed.

## 1. Purpose

Create one internal workspace to understand and operate NOFEKI's commercial lifecycle: customers, organizations, orders, subscriptions, payments, cash settlements, renewals, refunds, licenses, and provisioning exceptions.

The console must answer:
- What recurring value is currently contracted?
- How much cash actually settled, and what was refunded or charged in fees?
- Which renewals, payments, invoices, and licenses need attention?
- Did every verified payment result in the correct license?
- What is scheduled to renew, churn, or become overdue?

This is not a general ledger, tax filing tool, bank account, or replacement for accounting software.

## 2. Navigation

- Overview
- Customers & organizations
- Orders & checkout
- Subscriptions
- Payments & cash
- Invoices & documents
- Receivables
- Licenses & provisioning
- Revenue analytics
- Reconciliation & exceptions
- Audit & approvals
- Settings

## 3. Executive overview

### Core KPI strip

| KPI | Meaning | Guardrail |
|---|---|---|
| MRR | Monthly normalized recurring value of active paid subscriptions | Excludes trials, one-time fees and unpaid checkout |
| ARR | MRR multiplied by 12 | Run-rate, not cash or recognized accounting revenue |
| Cash settled | Payments confirmed settled in selected period | Excludes pending/authorized-only payments |
| Net cash | Settled cash less refunds, chargebacks and provider fees | Not profit |
| Active paying organizations | Organizations with an active paid subscription | Excludes trial-only and cancelled access |
| Active trials | Organizations currently within an eligible trial | Separate from paying customers |
| Past-due subscriptions | Subscription with due payment not confirmed under policy | Not automatically a receivable |
| Renewals next 30 days | Contracted renewals scheduled in next 30 days | Excludes cancellations effective before renewal |
| Failed payment rate | Failed attempts divided by eligible payment attempts | Show denominator and retry policy |
| Trial-to-paid conversion | Matured trial cohorts converting within defined window | Cohort-based |
| Gross revenue churn | MRR lost through cancellation/downgrade divided by opening MRR | Publish treatment of reactivation |
| Seat utilization | Active assigned seats divided by licensed seats | OPS only |

Default overview should prioritize MRR, cash settled, net cash, active paying organizations, past-due subscriptions, next 30-day renewals, and critical exceptions. Every KPI must expose formula, period, currency, timestamp, comparison, and drill-down.

### Charts
- MRR bridge: opening + new + expansion + reactivation − contraction − churn = closing MRR.
- Cash trend: settled receipts, refunds/chargebacks, fees, net settlement.
- Subscription status distribution.
- Trial funnel and cohort conversion.
- Plan mix and ARPA.
- Renewal schedule and forecast.
- Payment-to-license activation time and provisioning failures.

Do not fabricate zeros or chart lines when data is missing. Show “insufficient data” or stale/incomplete status.

### Alert center
Prioritize:
- payment succeeded but license not provisioned;
- paid order without invoice/document status;
- renewal failure or provider/internal state mismatch;
- refund or chargeback not reconciled;
- duplicate, replayed or mismatched payment event;
- active subscription with expired/revoked license;
- active license without valid paid/trial/approved grant;
- webhook in dead-letter;
- upcoming annual renewal requiring customer action;
- entitlement overuse.

Each alert carries severity, owner, age, linked organization/order/subscription, current state, next action and resolution evidence.

## 4. Filters and reporting dimensions

Global filters: period, product, module, plan/version, cadence, subscription/payment status, customer segment, organization size, country, currency, timezone, acquisition source (where lawfully captured), and account owner.

Never sum COP and USD into an unlabeled total. Any consolidated converted view must show source currency, FX rate, rate timestamp/source, and converted value separately.

## 5. Customer and organization 360

Organization detail includes:
1. Identity: display/legal name, country, verification status, owner, created date.
2. Contacts: billing, commercial, authorized buyer; minimum necessary personal data.
3. Commercial relationship: products, plan/version, accepted terms, cadence, start/end/renewal.
4. Financial position: orders, settled payments, refunds, credits, invoices/documents, validated open receivables.
5. Subscription timeline: trials, upgrades, downgrades, renewals, failures, cancellation.
6. Entitlements: licensed/assigned seats, warehouses, modules, limits, effective dates.
7. Provisioning health: activation and unresolved webhook/reconciliation errors.
8. Communications: billing notices and delivery status, not secrets.
9. Audit history: actor, action, timestamp, reason, approval and before/after references.

A person can belong to multiple organizations. Identity, organization, buyer, billing contact, and product end user are distinct concepts.

Never expose customer NOFEKI Gastos transactions, personal financial profiles, or OPS inventory content in this finance console. Billing requires commercial metadata, not customer product data.

## 6. Orders, payments, cash and documents

Maintain an append-only operational ledger with immutable source references and compensating entries rather than overwriting history.

Record:
- order and immutable line items;
- price, currency, tax configuration reference, discount, cadence and plan version;
- payment attempts and provider references;
- settled payments and settlement date;
- provider fees and settlement batch/reference;
- refunds, reversals, chargebacks and disputes;
- invoice/credit-note/document identifiers and external status;
- subscription periods and renewal events;
- approved manual credits/discounts/adjustments with reason and approval;
- source webhook and reconciliation evidence.

Keep separate:
- Order value: amount ordered.
- Payment authorized: authorization, not necessarily settled cash.
- Payment captured/paid: provider-confirmed payment; verify provider semantics.
- Settled cash: funds confirmed settled/available by provider/bank evidence.
- Provider fee: processing/other fee.
- Refund/chargeback: reversal linked to original payment.
- Invoice/document status: separate from payment status.
- Recognized revenue: accounting determination, not calculated by this console in v1.

An abandoned checkout does not automatically create a receivable. A failed renewal is an operational past-due state; only show a receivable when a valid invoice or enforceable payment obligation establishes it.

## 7. Subscription and renewal operations

Display states: trial, active, renewal_pending, past_due, grace, suspended, cancel_scheduled, cancelled, expired, pending_provisioning, reconciliation_required.

Renewal workflow:
1. Identify upcoming renewal from contract period and provider state.
2. Notify authorized billing contact under approved schedule.
3. Create renewal attempt once per idempotency context.
4. Reconcile provider webhook against authoritative payment state.
5. On verified success, extend paid-through period and license idempotently.
6. On failure, enter past_due and apply approved grace policy.
7. After grace, restrict protected access according to contract while preserving data/export.
8. Record cancellation/reactivation/adjustment as auditable events.

Queues: upcoming renewal, retry required, past due within grace, grace ending, suspended for non-payment, dispute/chargeback, valid invoice unpaid, payment received but provisioning incomplete.

Do not automatically send threatening or legal collection notices. Dunning templates, frequency, consent and escalation require legal review.

## 8. Revenue analytics

Minimum analytics:
- MRR movement: new, expansion, contraction, reactivation, churn.
- ARR run-rate.
- Bookings and order intake.
- Cash receipts, net settlements, refunds and fees.
- Subscription and organization cohorts.
- Trial activation/conversion.
- Logo retention, GRR and NRR.
- ARPA and ARPU where denominators are reliable.
- Plan mix, discounts, annual prepayment share.
- Renewal forecast, overdue exposure, payment recovery.
- Seat/warehouse utilization.

Forecasts must be labeled, show assumptions and distinguish contracted renewals from probability-weighted pipeline. Opportunities/quotes are not MRR.

## 9. Roles, access and approvals

Use proposed internal roles: platform_owner, platform_admin, billing_operator, auditor_read_only, support_agent and product_manager.

- Access is permission- and purpose-scoped.
- Billing operators cannot access customer expense or inventory data.
- Support sees redacted payment references and limited status.
- Auditors are read-only.
- Refunds, credits, manual price overrides, write-offs and material adjustments require reason, evidence and approval.
- No self-approval; exceptional/high-value adjustments require a second approver.
- Exports require separate permission, scope, reason and audit.
- Raw provider payloads and personal data are redacted by default.
- No customer impersonation in v1.

Monetary approval thresholds remain open and must be approved by NOFEKI ownership before implementation.

## 10. Reconciliation and data quality

Scheduled, read-first reconciliation compares:
- provider transactions vs internal payment attempts;
- provider settlements vs bank/provider settlement batches;
- payments vs orders and invoice references;
- subscriptions vs paid-through periods;
- subscriptions vs licenses/entitlements;
- refunds/chargebacks vs adjustments and net cash;
- paid orders vs provisioning;
- licensed capacity vs active seat assignments.

Mismatch records include expected/observed state, source timestamp, evidence, severity, owner and resolution. Automated correction is limited to deterministic, reversible, idempotent cases. Ambiguous, high-value or bulk corrections require human approval. Never silently rewrite history.

## 11. Exports

V1 reports: monthly cash collection by currency; settlement/fee reconciliation; MRR/ARR snapshot and movement; subscription/renewal schedule; validated overdue list; organization commercial summary; license/seat utilization; refund/credit/chargeback register; audit extract.

Every export includes generated timestamp, timezone, filters, currency, source-of-truth note and completeness status. CSV is sufficient for v1.

## 12. Colombia legal, tax and accounting boundary

NOFEKI must determine the seller's actual legal/tax status and invoicing obligations with a Colombian accountant or tax adviser before charging customers. DIAN guidance describes the general obligation to issue invoices for sales/services subject to statutory exceptions; applicability depends on the seller and current rules. References: [DIAN — Ser facturador electrónico](https://www.dian.gov.co/impuestos/factura-electronica/como-hacerlo/Paginas/ser-facturador-electronico.aspx) and [DIAN — Sistema de Factura Electrónica](https://www.dian.gov.co/impuestos/Paginas/Sistema-de-Factura-Electronica/Sistema-de-Factura-Electronica.aspx).

This console may store document identifiers/statuses, but must not claim DIAN-compliant invoice issuance until a qualified provider/process and legal configuration are selected and tested. IVA, withholding, electronic invoicing, credit notes, retention, currency and record-retention treatment require professional validation.

MRR, ARR, bookings and cash are management metrics, not automatically accounting revenue. IFRS 15 frames revenue recognition around satisfying performance obligations and transferring promised goods/services. The accountant must determine the framework and treatment applicable to NOFEKI contracts. Reference: [IFRS — IFRS 15](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-15-revenue-from-contracts-with-customers/).

## 13. V1 exclusions

No general ledger/double-entry accounting, tax return preparation, tax filing, DIAN invoice issuance, custody or transfer of funds, legal debt collection, automatic write-offs, arbitrary MRR editing, customer expense/inventory data, payment-provider integration, automatic pricing changes, or AI forecasting before reliable history exists.

## 14. Delivery phases

- **A — Definition:** approve KPI definitions, commercial states, roles, approval thresholds and accounting boundaries.
- **B — Read-only console:** display customers, plans, subscriptions, orders, payment events, licenses and exceptions.
- **C — Controlled operations:** refunds/credits/plan changes and dunning with dual control and audit.
- **D — Analytics:** cohorts, retention, renewal forecast and unit economics.
- **E — Accounting integration:** only after provider, invoice process, legal/tax model and accounting system are selected.

Each phase requires a separate implementation plan, isolated test strategy, security review and explicit release authorization.

## 15. Open decisions

1. Which legal entity/person sells NOFEKI subscriptions?
2. Which accounting software and invoicing provider will be used?
3. Which Colombian tax/invoicing obligations apply to seller and services?
4. What monetary thresholds require dual approval?
5. What grace period and retry schedule are approved?
6. Which provider/settlement evidence is authoritative?
7. Which countries/currencies launch?
8. Who owns finance operations and account management?
9. What is the retention policy for invoices, payment evidence and audit events?
10. Which reports reconcile monthly with the accountant?

**Implementation status:** Design only. No console, schema, APIs, provider connection or production change.
