# NOFEKI Platforms — Finance KPI Dictionary v1

**Status:** Proposed management metric definitions; not implemented.  
**Purpose:** Consistent formulas for the internal finance console.  
**Currency:** COP baseline; never aggregate currencies without explicit FX metadata.

## 1. Measurement principles

- Store timestamps in UTC; display reporting timezone.
- Every metric carries period, as-of timestamp, currency, filters and completeness.
- Separate snapshot metrics from period flows.
- Separate contracted recurring value, bookings, payment activity, settled cash and accounting revenue.
- Use immutable event history and versioned plan prices.
- Exclude sandbox/test transactions and internal/demo organizations unless explicitly requested.
- Trials are not paid MRR; one-time fees are not MRR.
- Abandoned checkout is not debt.
- MRR/ARR are not cash or recognized revenue.

## 2. Recurring metrics

### MRR — Monthly Recurring Revenue (management run-rate)
At snapshot time, sum monthly normalized recurring contract value of active paid subscriptions with a valid entitlement period.

- Monthly subscription: current recurring monthly amount.
- Annual subscription: recurring annual amount divided by 12.
- Approved recurring add-on: monthly amount, or annual amount divided by 12.
- Apply approved recurring discounts.
- Exclude taxes collected for authorities, one-time fees, trials, unpaid checkout, and subscriptions after effective cancellation/expiry/suspension without paid rights.

Report gross list-price MRR and net-of-discount MRR separately where possible. Allocate only recurring subscription value if annual contract includes one-time services.

### ARR — Annual Recurring Revenue
ARR = MRR × 12. This is a point-in-time annualized run-rate, not guaranteed cash, invoice total, forecast, or accounting revenue. Never annualize one-time fees.

### MRR movements
- New MRR: first paid recurring value activated in period; trial start does not count.
- Expansion MRR: effective increase from upgrade, seats, warehouses or recurring add-ons.
- Contraction MRR: effective decrease from downgrade/add-on reduction.
- Reactivation MRR: recurring value restored after churn/cancellation.
- Churned MRR: recurring value lost when paid service ends.
- Net New MRR = New + Expansion + Reactivation − Contraction − Churned.

### Retention
- Logo churn = organizations lost during period / paying organizations at period start.
- GRR = (Opening MRR − Contraction MRR − Churned MRR) / Opening MRR.
- NRR = (Opening MRR + Expansion + Reactivation − Contraction − Churned MRR) / Opening MRR.
- If opening MRR is zero, return N/A.
- Define loss at organization level. A customer cancelling one product remains a paying logo if another paid subscription remains.
- Default NRR includes reactivation only when the organization belonged to the opening cohort; document alternative convention when comparing.

## 3. Sales and order metrics

### Bookings
Value of accepted customer orders/contracts in period, based on immutable order line items and agreed term. Show total contract value, annual contract value, one-time services, taxes and discounts separately. Unsigned quote, abandoned checkout and unaccepted proposal are not bookings.

### New paying organizations
Distinct organizations with first verified paid subscription activation in period. Exclude trial-only.

### Trial starts
Distinct eligible organizations whose trial grant activated in period. Extension is not a new trial.

### Trial-to-paid conversion
Organizations in a trial-start cohort that activate paid subscription within conversion window / eligible organizations in that matured cohort. Default window: 30 days from trial end. Exclude immature cohorts from denominator or label separately.

### ARPA — Average Revenue Per Account
MRR / active paying organizations. Label “per paying organization”; return N/A if denominator zero.

### ARPU — Average Revenue Per User
MRR / active paid users with assigned entitled seat. Use only when seat assignment and active-user definition are reliable; never divide by all registered or invited users.

### Realized plan price
Average recurring subscription value per new paid subscription, net of discounts, excluding tax and one-time fees. Show weighted/unweighted only when useful.

## 4. Cash and payment metrics

- Gross cash collected: successful settled payments in period using settlement date, not checkout, authorization or webhook receipt date.
- Refunds/chargebacks: completed cash reversals in period; pending disputes shown separately.
- Provider fees: fees actually charged/withheld; estimates labeled separately.
- Net cash received = Gross settled cash − completed refunds/chargebacks − provider fees.
- Payment success rate = distinct successful attempts / (distinct successful + distinct failed attempts). Exclude pending, cancelled-before-submission and duplicate webhook events. Show attempt-level and order-level eventual success separately.
- Recovery rate = past-due subscriptions recovered within defined window / past-due subscriptions entering matured cohort. Default window: 30 days.
- Collection time = elapsed time from valid due date to settlement; show median and percentiles.

Net cash is not profit or necessarily bank cash after all transfers, withholding, taxes and operating expenses.

## 5. Receivables

Open receivable = amount due under valid issued invoice or other enforceable contractual payment obligation, less settled payments, valid credits and effective adjustments.

Do not include abandoned checkout, failed payment without established obligation, unsigned quote, unaccepted proposal or pending authorization.

Overdue receivable = open receivable with due date before reporting date. Age buckets: not due, 1–7, 8–30, 31–60, 61–90, over 90 days. Validate due-date policy with accountant/legal adviser.

Past-due subscription exposure is a separate operational metric until legal/accounting policy establishes a receivable.

## 6. Renewals and forecast

- Contracted renewals next N days: active paid subscriptions scheduled to renew within N days, excluding cancellations effective before renewal.
- Renewal forecast groups: contracted; customer action required; at risk; pipeline.
- Expected renewal cash is expected charge amount, not settled cash.
- Quotes/opportunities are not contracted MRR.
- Probability-weighted forecasts must disclose assumptions and historical conversion basis.

## 7. Usage and commercial health

- Seat utilization = active assigned seats / licensed seat capacity.
- Warehouse utilization = active configured warehouses / licensed warehouse limit.
- Discount rate = (comparable list price − contracted recurring price) / list price. Compare same plan version/cadence; separate coupon, negotiated and annual-cadence discounts.
- Annual prepayment share: annual-billed active MRR / total active paid MRR. Show annual cash separately; do not count 12 months of annual prepayment as one month's MRR.
- Payment-to-activation time: authoritative successful payment timestamp to license/entitlement activation; report median and p95.
- Provisioning success rate = eligible provisioning requests completed / eligible provisioning requests.

## 8. Edge cases

1. Mid-cycle plan change: use effective timestamp and approved proration policy; do not invent prorated amounts.
2. Annual refund: preserve original cash history and record adjustment/refund event.
3. Scheduled cancellation: retain MRR until effective end date unless contract ends rights earlier.
4. Payment failure: separate past-due status from MRR removal; follow paid-rights policy.
5. Grace: show separately; proposed default excludes free grace from MRR after paid-through expiry.
6. Trial/free plan: excluded from MRR/ARR.
7. Discounts: use actual contracted net recurring amount and preserve list price/reason.
8. Taxes: exclude amounts collected for authorities from MRR; show gross customer charge separately.
9. Onboarding/integration: one-time fees excluded from MRR.
10. Multiple products: preserve product MRR; aggregate organization-level ARPA/logo churn.
11. FX: preserve native currency and show rate source/date for converted view.
12. Duplicate/out-of-order events: deduplicate and reconcile authoritative provider state.
13. Missing data: show incomplete/unknown, not zero.

## 9. Safe display labels

Use “MRR (run-rate)”, “ARR (annualized run-rate)”, “Cash settled”, “Net cash after refunds and provider fees”, “Bookings / contract value”, “Open receivables (validated)”, “Past-due subscriptions (operational)” and “Renewal forecast”.

Avoid unqualified “revenue” for MRR/bookings/cash, “debt” for abandoned checkout, “profit” when only fees are deducted, or “guaranteed income” for forecast renewals.

## 10. Approval before implementation

Finance owner and accountant must approve revenue-recognition mapping, invoice/due-date semantics, tax treatment, annual prepayment, discounts, refunds, credits, chargebacks, FX, grace-period MRR, cancellation dates, customer/account definition, and retention/evidence requirements.

**Implementation status:** Dictionary only. No production calculations are connected.
