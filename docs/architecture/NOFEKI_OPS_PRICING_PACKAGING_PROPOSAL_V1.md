# NOFEKI OPS — Pricing, Packaging & Licensing Proposal v1

**Status:** Commercial proposal v1.1; user-selected price anchors and billing cadence, still subject to market, legal, tax, and unit-economics validation.  
**Currency:** COP. All prices below are proposed before any applicable taxes.  
**Scope:** NOFEKI OPS launch packaging and commercial rules inside NOFEKI Platforms.  
**Safety:** No checkout, payment gateway, production database, Auth, or license provisioning has been implemented.

## 1. Executive recommendation

Launch NOFEKI OPS with three simple organization plans, priced per organization with included seats and transparent limits. Avoid charging separately for every basic inventory action. Monetize increasing operational complexity, team size, multi-warehouse needs, analytics, and integrations.

Proposed initial price hypotheses:

| Plan | Monthly list-price hypothesis | Included seats | Intended customer |
|---|---:|---:|---|
| Essential | $299.000 COP | 3 | Small operation formalizing inventory control |
| Growth | $599.000 COP | 10 | Growing company with purchasing and multiple users |
| Scale | $1.199.000 COP | 25 | Multi-warehouse operation requiring stronger control and analytics |

These are validation anchors, not claims of market-verified willingness to pay. The 2026 Capterra pricing overview reports broad dispersion by vendor and model, with flat, per-user, and usage-based pricing all common; this supports testing a transparent organization subscription rather than copying a single competitor's price. See [Capterra 2026 pricing overview](https://www.capterra.com/resources/inventory-management-software-pricing/).

## 2. Packaging proposal

### Essential — $299.000 COP/month (hypothesis)

For a small team beginning to standardize inventory.

Included:
- 1 organization.
- Up to 3 active seats.
- 1 warehouse/location.
- Inventory catalog and SKU master.
- Stock movements and adjustments.
- Basic receipts and dispatch records.
- Minimum/maximum stock indicators.
- Basic ABC classification and rotation view.
- Standard dashboard and CSV import/export.
- Standard support channel.

Not included:
- Purchase workflow/approvals.
- Multi-warehouse transfers.
- Advanced analytics or custom reports.
- ERP/SAP integration.
- API access or custom automation.

### Growth — $599.000 COP/month (hypothesis)

For a growing operation with procurement and a wider team.

Everything in Essential, plus:
- Up to 10 active seats.
- Up to 3 warehouses/locations.
- Purchasing requests and purchase orders.
- Supplier catalog and lead-time fields.
- Receiving workflow and discrepancy tracking.
- Warehouse transfers and stock in transit.
- Replenishment alerts and configurable min/max.
- ABC/XYZ and rotation analysis.
- Role-based product permissions.
- Downloadable operational reports.
- Priority support target (business-hours response target to be defined).

### Scale — $1.199.000 COP/month (hypothesis)

For complex operations with several sites and stronger governance.

Everything in Growth, plus:
- Up to 25 active seats.
- Up to 10 warehouses/locations.
- Advanced dashboards and configurable KPIs.
- Multi-step approvals and audit history.
- Advanced replenishment parameters and planning scenarios.
- Inventory health checks and action plans.
- Higher import/export and API quotas.
- Extended support target (to be contractually defined).
- Integration readiness package; actual SAP/ERP implementation quoted separately.

## 3. Add-ons and expansion

Do not make the first purchase depend on add-ons. Proposed expansion rules for validation:

| Add-on | Proposed commercial treatment |
|---|---|
| Additional seat | $25.000 COP/month per active seat above included quantity |
| Additional warehouse | $60.000 COP/month per active warehouse above plan limit |
| Advanced analytics pack | $150.000 COP/month, only if not already included in Scale |
| API / automation pack | Starting at $150.000 COP/month, quota and use policy required |
| SAP / ERP integration | One-time implementation quote + recurring support/maintenance if applicable |
| Dedicated onboarding | One-time fee based on hours and scope |
| Custom development | Separately scoped statement of work; never implied by subscription |

Avoid charging for a seat that is merely invited but has not accepted or been activated. Define whether suspended users count toward licensed seats; proposed default: only active assignments count, but a suspended assignment reserves a seat until explicitly released.

## 4. Billing cadence and incentives

**Confirmed decision:** offer both monthly and annual billing.

- Monthly: list price, billed in advance.
- Annual: 10% discount against 12 monthly list-price payments, billed in advance (proposal to validate financially).

| Plan | Monthly | Annual before discount | Annual with 10% discount | Monthly equivalent when paid annually |
|---|---:|---:|---:|---:|
| Essential | $299.000 | $3.588.000 | $3.229.200 | $269.100 |
| Growth | $599.000 | $7.188.000 | $6.469.200 | $539.100 |
| Scale | $1.199.000 | $14.388.000 | $12.949.200 | $1.079.100 |

Amounts are COP, before applicable taxes and any separately agreed onboarding or integration fees.
- No lifetime license at launch.
- No automatic price increase during a committed annual period.
- Price changes apply at renewal with advance notice and explicit customer communication.
- Discounts beyond the approved promotion band require billing operator approval and reason.
- Any custom contract must store its own price/version and expiry; never overwrite the public plan.

Annual discount calculation should be server-side from the versioned price catalog. Do not trust a client-supplied amount or discount.

## 5. Trial policy

Confirmed launch decision:
- 7-day trial for Growth capabilities.
- No payment card required to start.
- One trial per verified organization, with abuse controls based on organization identity and verified owner—not email alone.
- Trial start timestamp and end timestamp stored explicitly.
- Trial clearly marked in portal and admin console.
- Reminders at 7 days remaining, 3 days remaining, and 1 day remaining.
- At trial end, do not delete data. Move license to expired/read-only grace only if that policy is approved; otherwise block new protected writes while allowing an export and plan-selection path.
- One extension of up to 7 days may be granted by an authorized billing operator with reason and audit trail.
- A trial does not silently convert to paid. Customer must affirmatively choose a plan and complete checkout.

Trial entitlements should be a plan version or trial grant, not a hidden boolean bypass.

## 6. Seat, warehouse, and module entitlement rules

### Seats
- License defines purchased seat capacity.
- Assignment requires active organization membership.
- Capacity check and assignment must be atomic to prevent race conditions.
- Owner does not receive a seat automatically unless the selected plan explicitly says so; recommendation for launch: owner consumes one seat.
- Seat transfer is allowed by an org admin after releasing the previous assignment.
- Seat count decrease cannot take effect while active assignments exceed the new cap.

### Warehouses
- Count active configured warehouses, not historical/inactive locations.
- Deactivation preserves movement history.
- Plan downgrade that exceeds the new warehouse limit requires customer action before effective date.

### Modules
Proposed entitlement keys:
- `ops.inventory.core`
- `ops.inventory.movements`
- `ops.inventory.replenishment.basic`
- `ops.purchasing.core`
- `ops.warehouse.multi_location`
- `ops.analytics.abc_rotation`
- `ops.analytics.advanced`
- `ops.approvals.workflow`
- `ops.api.standard`
- `ops.integrations.custom`

Product roles and permissions are independent of entitlements. A licensed organization may have the purchasing module, but a member can create purchase orders only if their product role grants that permission.

## 7. Feature-to-plan matrix

| Capability | Essential | Growth | Scale |
|---|:---:|:---:|:---:|
| Inventory catalog / SKU | Yes | Yes | Yes |
| Stock movements | Yes | Yes | Yes |
| Basic min/max | Yes | Yes | Yes |
| Basic ABC / rotation | Yes | Yes | Yes |
| Purchasing / suppliers | — | Yes | Yes |
| Multi-warehouse | — | Up to 3 | Up to 10 |
| Transfers | — | Yes | Yes |
| Advanced analytics | — | — | Yes |
| Approval workflows | — | Basic | Advanced |
| API quota | — | Limited | Higher |
| Custom ERP/SAP integration | Quoted | Quoted | Quoted |
| Included seats | 3 | 10 | 25 |

## 8. Downgrade and cancellation behavior

- Downgrade is scheduled for the next renewal by default.
- Portal displays affected seats, warehouses, modules, and features before confirmation.
- Customer must reduce assignments/locations or accept a documented restricted state before downgrade takes effect.
- Do not delete inventory, movement, purchasing, or audit records due to downgrade.
- Cancellation ends future renewal; access continues through paid-through date unless fraud/security/policy requires immediate suspension.
- At expiry, prevent new writes according to a published policy and offer data export for a defined period.
- Refunds and prorations follow a separately approved legal/commercial policy; do not promise automatic refunds in product UI until defined.

## 9. Payment-provider selection — decision still open

A provider should be selected only after checking merchant eligibility, recurring-payment capabilities, fees, settlement timing, refunds/chargebacks, tax/invoicing needs, and technical support.

Initial candidates to evaluate:

- **Wompi:** Colombian payment documentation describes webhook events for payment lifecycle changes and separate event URLs for sandbox and production. Its tokenization product also describes recurring payments. Confirm the exact recurring product, merchant eligibility, fees, and operational terms before choosing. Sources: [Wompi payment events](https://docs.wompi.co/docs/colombia/eventos/) and [Wompi tokenization](https://wompi.com/es/co/soluciones/pagos-en-linea/webcheckout-api-plugins/tokenizacion).
- **Mercado Pago:** Colombian developer documentation describes signed webhook notifications, retrieval of the underlying payment/subscription resource, and idempotency for payment creation. Confirm the subscription product and current commercial fees/availability for the intended account. Sources: [Mercado Pago webhooks](https://www.mercadopago.com.co/developers/es/docs/links-and-debts/additional-content/your-integrations/notifications/webhooks?scope=prod) and [recurring payments](https://www.mercadopago.com.co/developers/en/docs/automatic-payments-orders/process-recurring-payments?scope=prod).

Recommendation: build a provider-neutral billing adapter and choose one provider only after a side-by-side commercial and technical evaluation. Do not integrate both at launch.

## 10. Pricing validation before public launch

Conduct 8–12 structured interviews with target companies (small manufacturers, distributors, wholesalers, and operations teams). Test:
1. Whether the buyer prefers organization pricing or per-seat pricing.
2. Whether the three seat/warehouse limits map to actual operating teams.
3. Which features trigger a purchase: purchasing, multi-warehouse, analytics, approvals, integrations.
4. Whether the proposed monthly bands feel low, fair, expensive, or unacceptable.
5. Whether annual prepayment is realistic.
6. Whether the buyer expects onboarding or ERP integration included.
7. What business outcome would justify the price (stock accuracy, reduced obsolescence, fewer stockouts, less manual work).

Do not ask only “would you pay?” Ask for current process, cost of current tools/errors, buying authority, budget range, and concrete next step. Record segment, company size, warehouse count, users, current tools, and objections.

### Decision gates
- **Gate 1 — Packaging:** validate features and limits.
- **Gate 2 — Price:** validate price bands and willingness to pay.
- **Gate 3 — Unit economics:** calculate payment fees, hosting, support, onboarding, and gross margin.
- **Gate 4 — Legal/tax:** approve invoicing, taxes, terms, privacy, cancellation, and refund policies.
- **Gate 5 — Launch:** publish only after checkout, webhook, provisioning, renewal, cancellation, and data-export tests pass.

## 11. Example revenue scenarios (illustrative, not forecast)

| Scenario | Essential | Growth | Scale | Monthly gross recurring revenue |
|---|---:|---:|---:|---:|
| Pilot 1 | 5 | 3 | 1 | $4.691.000 COP |
| Early traction | 10 | 8 | 3 | $9.185.000 COP |
| Growth | 20 | 15 | 5 | $17.965.000 COP |

These amounts are simple plan-price multiplication before taxes, discounts, refunds, payment fees, support, hosting, onboarding, churn, or bad debt. They are not revenue forecasts.

## 12. Decisions required from NOFEKI before publishing

1. Approve or revise the three proposed price anchors.
2. Confirm whether owner consumes a seat.
3. Confirm trial duration and extension policy.
4. Confirm whether monthly and annual billing are both offered at launch.
5. Define cancellation, grace, refund, and data-export periods.
6. Confirm included onboarding/support levels.
7. Select initial payment provider after commercial due diligence.
8. Confirm tax/invoicing treatment with Colombian accounting/legal advice.
9. Confirm whether Essential includes ABC/rotation in the first product release.
10. Confirm actual OPS capabilities against the current product roadmap before marketing any feature.

## 13. Confirmed user decisions and remaining approvals

Confirmed by the NOFEKI owner for this proposal:
1. Retain the three proposed monthly price anchors: Essential $299.000, Growth $599.000, Scale $1.199.000 COP.
2. Offer both monthly and annual billing.
3. Set the initial trial duration to 7 days.

Still not approved for public launch: final tax treatment, public price display, annual discount economics, provider selection, refund/proration terms, grace period, support SLAs, and feature availability against the shipped OPS product. Prices remain proposal values pending those gates.

**Do not publish checkout or activate paid licenses until the remaining approvals and technical acceptance tests are complete.**
