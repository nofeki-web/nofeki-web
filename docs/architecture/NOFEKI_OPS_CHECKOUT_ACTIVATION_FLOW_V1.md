# NOFEKI Platforms — OPS Checkout & Activation UX/Technical Flow v1

**Status:** Functional/technical design; not implemented.  
**Decisions incorporated:** price anchors retained; monthly and annual billing; 7-day Growth trial.  
**Safety:** No payment provider selected or connected. No production code, database, Auth, Edge Function, RLS, Vercel, or deployment changes.

## 1. Objective

Design the customer journey that converts an interested organization into an active NOFEKI OPS customer, while ensuring that payment verification, licensing, seat allocation, and product authorization are separate, traceable steps.

## 2. Confirmed commercial catalog inputs

| Plan | Monthly | Annual (10% discount) | Seats | Active warehouses |
|---|---:|---:|---:|---:|
| Essential | $299.000 COP | $3.229.200 COP | 3 | 1 |
| Growth | $599.000 COP | $6.469.200 COP | 10 | 3 |
| Scale | $1.199.000 COP | $12.949.200 COP | 25 | 10 |

Annual values are 12 months less 10%, calculated server-side. Values are pre-tax proposal amounts; tax/invoicing treatment remains to be approved.

**Trial:** 7 calendar days of Growth capabilities, no payment card required, no silent auto-conversion. One trial per verified organization under an approved abuse-control policy. A trial may be extended once by up to 7 days by an authorized billing operator, with a reason and audit event.

## 3. Customer-facing journey

### Screen 1 — Product and plan selection

Customer sees:
- Essential, Growth, Scale cards;
- monthly/annual toggle;
- included users, warehouses, modules, and support scope;
- total price and billing period;
- note that taxes or one-time services may apply if legally relevant;
- trial CTA: “Probar Growth gratis por 7 días”.

Rules:
- The catalog is sourced from active, versioned server configuration.
- Price and included limits are not accepted from browser input.
- Show only features confirmed as released and saleable.
- Mark roadmap features as unavailable; never market them as included.

### Screen 2 — Authentication

If logged out, user registers or signs in using the current NOFEKI identity flow. Existing Gastos users must retain the current direct Gastos access and session behavior. Do not alter the existing Gastos storage key or recovery flow in this phase.

After authentication, resolve the canonical Auth user UUID. Do not create a second identity based on email or display name.

### Screen 3 — Purchase context

User selects:
- **Use an existing organization** (only active organizations where the user has appropriate authority); or
- **Create an organization**.

Organization creation collects minimum necessary information: display/legal name, country, billing contact, and owner confirmation. Tax identifiers and legal verification fields remain subject to legal/accounting approval.

An organization begins in `pending_verification` and cannot purchase on behalf of that organization until the owner/authority checks are satisfied.

### Screen 4 — Organization and billing details

Display:
- organization name and selected billing contact;
- buyer identity and contact;
- country and invoice requirements;
- billing cadence;
- plan version and quantity;
- any approved discount or coupon;
- price before taxes, tax estimate/final tax if legally configured, and total due;
- terms, privacy, recurring-payment authorization where applicable, cancellation rules, and checkbox/affirmative consent records.

A buyer can be distinct from the organization owner and from OPS end users. Record who accepted the commercial terms and on whose behalf.

### Screen 5 — Order review

Server creates an internal order in `draft` or `pending_checkout` after revalidating:
- active plan version;
- organization eligibility;
- buyer permission;
- price, currency, cadence, quantity, discount;
- trial eligibility if the trial CTA was selected;
- idempotency key.

The UI presents an order summary and a clear “Continue to payment” action. Repeated clicks/retries must reuse the same order idempotency context, not create multiple payable orders.

### Screen 6 — Hosted payment

Redirect to the selected provider's hosted checkout or approved secure payment UI. NOFEKI must not collect or store full card numbers, CVV, bank credentials, or payment passwords.

The provider is not yet selected. Provider adapter must support sandbox and production separation, signed webhooks, payment status retrieval, refund/cancellation capability as needed, and recurring billing if automatic renewals are offered.

### Screen 7 — Return and pending state

The return URL is informational only. It displays:
- “Estamos confirmando tu pago”;
- internal order reference (safe public identifier);
- current order status;
- instruction to wait or revisit status.

Never activate a license from a query parameter, redirect flag, client-side success callback, or browser-supplied payment status.

### Screen 8 — Activation confirmation

After verified payment and successful provisioning:
- show plan, billing period, paid-through date, seats and warehouse limits;
- for organization purchase, show seat allocation step;
- invite team members or assign existing members;
- launch OPS using the platform's server-authorized launch contract.

If payment is verified but provisioning is delayed, show “Pago confirmado; estamos habilitando tu espacio” and create an operational alert. Do not ask the customer to pay again.

## 4. Trial journey

1. User selects “Probar Growth gratis por 7 días”.
2. Server checks verified organization eligibility and prior trial history.
3. Create trial grant with exact UTC start and end timestamps, plan version, scope, and owner.
4. Enable Growth trial entitlements server-side.
5. Show countdown and end date in portal.
6. Send reminders at 3 days and 1 day remaining (7-day trial is too short for a 7-day reminder).
7. Before expiry, present monthly/annual conversion options.
8. Trial ends at the recorded server timestamp unless an authorized extension is granted.
9. No automatic paid conversion. Customer must explicitly choose a plan and complete checkout.
10. On expiry, preserve customer data and apply the approved read-only/export grace policy. Until that policy is approved, do not implement destructive deletion or automatic data removal.

## 5. Subscription and renewal UX

Account area must show:
- current plan and version;
- monthly or annual cadence;
- current status (trial, active, payment pending, past due, grace, suspended, cancelled);
- next charge date / paid-through date;
- seats purchased, assigned, and available;
- warehouses in use and limit;
- enabled modules;
- billing contact and invoices/payment references;
- cancellation or plan-change action with impact preview.

Renewal:
- notify billing contact before renewal according to an approved cadence;
- provider webhook triggers reconciliation;
- success extends paid-through period and license;
- failure enters `past_due` then approved grace policy;
- no silent data deletion;
- reactivation requires verified payment or explicitly approved operator action.

## 6. Plan change and cancellation UX

### Upgrade
Show immediate vs next-cycle effect and any prorated amount. Do not implement proration until provider and policy are selected. Entitlements expand only after verified payment or an approved zero-cost adjustment.

### Downgrade
Default to next renewal. Show which modules, seats, warehouses, API quotas, and users are affected. Customer must reduce usage or accept a documented restricted state before effective date. Never delete inventory or movement history.

### Cancellation
Show cancellation effective date, renewal behavior, refund policy link, paid-through date, data export window, and seat impact. Confirm billing authority and require affirmative confirmation. Cancellation does not automatically imply immediate access revocation.

## 7. Backend sequence and trust boundaries

1. Client requests a quote using plan key, cadence, organization ID, and optional approved promotion code.
2. Server resolves user from validated JWT and verifies organization membership/role.
3. Server loads current plan version and calculates all amounts and limits.
4. Server creates order + immutable line items + idempotency record.
5. Server creates provider checkout session using private credentials.
6. Client is redirected to provider.
7. Provider sends webhook to server.
8. Server validates signature, event freshness/replay policy, provider account, order reference, amount, currency, and authoritative payment state.
9. Server stores provider event idempotently and queues reconciliation/provisioning.
10. Provisioning creates/activates license and entitlement snapshot/version idempotently.
11. Server marks order fulfilled only after license and entitlement changes commit.
12. Portal reads current access from server; OPS API independently enforces license, entitlement, membership, and product role.

Use a transactional outbox or durable job queue so a verified payment cannot be lost between marking an order paid and creating its license.

## 8. Provider evaluation notes

Do not choose a provider solely because it supports a one-time checkout. Recurring billing must be verified for the exact Colombian merchant account, payment methods, fees, settlement, refunds, chargebacks, and tax workflow.

- **Wompi:** Colombian docs describe webhooks for transaction status changes and separate sandbox/production event URLs. Its payment-source documentation describes tokenized sources and recurring charges, with explicit payment-source setup and customer authorization requirements. Sources: [Events](https://docs.wompi.co/docs/colombia/eventos/), [Payment sources and tokenization](https://docs.wompi.co/en/docs/colombia/fuentes-de-pago/), [Tokenization product](https://wompi.com/es/co/soluciones/pagos-en-linea/webcheckout-api-plugins/tokenizacion).
- **Mercado Pago:** Colombian docs list webhook topics for payments and subscription lifecycle, including authorized subscription payments and preapproval updates. Scheduled recurring payments are documented separately and use server-side credentials. Sources: [Webhooks](https://www.mercadopago.com.co/developers/es/docs/checkout-pro-orders/resources/notifications/webhooks), [Scheduled recurring payments](https://www.mercadopago.com.co/developers/en/docs/automatic-payments-orders/process-recurring-payments?scope=prod).

Technical documentation does not confirm account-specific merchant eligibility, negotiated fees, settlement times, or the final tax/invoicing treatment. Obtain commercial confirmation before selection.

## 9. Required failure states

| Failure | Customer message | System behavior |
|---|---|---|
| Checkout session creation fails | Could not start payment; try again | Keep order pending; safe retry |
| Customer abandons checkout | Payment not completed | Expire checkout session/order per policy |
| Provider webhook invalid | We are verifying the transaction | Reject event; no license change; alert |
| Payment pending | Payment is still processing | Keep no paid entitlement |
| Payment rejected | Payment was not approved | Offer retry/new attempt without duplicate order |
| Payment approved, provisioning fails | Payment confirmed; activation in progress | Retry provisioning; alert; never charge again |
| Duplicate webhook | No customer-visible error | Acknowledge idempotently |
| Renewal fails | We could not confirm renewal | Enter past_due; notify billing contact |
| License expired | Plan access has ended | Block new protected writes; preserve data per policy |
| Seat limit reached | No seats available | Require release or approved seat expansion |

## 10. Acceptance tests before any production release

- Existing Gastos user can sign in and still access Gastos directly.
- New customer can create an organization without creating duplicate identities.
- Unauthorized member cannot create an order for an organization.
- Browser cannot alter price, cadence, currency, plan version, or seat quantity.
- Trial is exactly 7 days by server time and cannot silently convert to paid.
- Duplicate trial requests cannot create multiple concurrent trials for the same organization.
- Monthly and annual totals are calculated server-side and match approved catalog.
- Return URL alone never activates a license.
- Invalid/replayed/duplicate/out-of-order webhooks are handled safely.
- Payment success + provisioning failure recovers without a second charge.
- Concurrent seat assignments cannot exceed plan capacity.
- Cancellation and downgrade show impact and apply only on the approved effective date.
- Payment credentials and secrets never appear in browser, logs, or repository.
- OPS API denies access after license expiry/revocation even if the portal UI is stale.
- Audit events capture buyer consent, order, payment, provisioning, renewal, plan changes, and cancellation.

## 11. Explicitly not implemented

This document does not select Wompi or Mercado Pago, create provider credentials, implement checkout pages, create commercial database tables, modify Auth/RLS/Edge Functions, configure webhook URLs, change Vercel, or deploy. These require separate implementation planning, sandbox testing, legal/accounting approval, and explicit release authorization.
