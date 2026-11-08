# NOFEKI Platforms — Commercial Lifecycle & Customer Operations v1

**Status:** Proposed business and technical workflow; not implemented.  
**Scope:** From registration and product discovery through purchase, provisioning, renewal, suspension, cancellation, and offboarding.  
**Safety:** No payment provider, production database, Auth, Edge Function, RLS, Vercel, or deployment changes are included.

## 1. Goals and invariants

NOFEKI Platforms must provide a consistent commercial lifecycle across NOFEKI Gastos (free personal product), NOFEKI OPS (paid/licensable product), and future products.

Non-negotiable invariants:
1. One canonical person identity based on the existing authenticated user UUID.
2. A user can have a personal context and memberships in multiple organizations.
3. A purchase creates a commercial record; it does not directly grant API access.
4. Product access is resolved from active license + entitlement + membership/context + product permission.
5. Payment status is verified server-to-server, never inferred from a browser redirect.
6. Every lifecycle transition is idempotent, auditable, and traceable to a source event or operator.
7. A failed Platforms workflow must not interrupt existing direct NOFEKI Gastos access.
8. Existing Gastos data and tables remain untouched during the first integration phase.

## 2. Actors and commercial scopes

- **Prospect:** visitor who has not created an account.
- **Registered user:** authenticated person with a personal workspace.
- **Personal customer:** user accessing a personal product or personal license.
- **Organization owner:** verified person responsible for an organization workspace.
- **Buyer / billing contact:** authorized person who initiates checkout or manages payment.
- **Seat administrator:** organization administrator allowed to assign purchased seats.
- **NOFEKI billing operator:** internal role managing commercial exceptions and reconciliation.
- **Payment provider:** future external system; provider-neutral adapter required.

A buyer, organization owner, and end user may be different people. A buyer does not automatically gain product permissions, and an end user does not automatically gain billing permissions.

## 3. End-to-end lifecycle

### Stage A — Discovery and registration

1. Visitor sees product catalog and plan information without needing an account.
2. Selecting a protected action (start trial, checkout, create organization) requires authentication.
3. Existing user signs in with the current Auth flow; new user registers through the established flow.
4. Platforms resolves the canonical user UUID and creates/associates the personal workspace idempotently.
5. User verifies required contact information before commercial actions.
6. User selects personal or organization purchase context.

Do not create duplicate identities by matching only display name. Email changes must not create a new user identity.

### Stage B — Organization setup

1. User enters legal/display name, country, billing contact, and minimum required business details.
2. Platforms creates organization in `pending_verification`.
3. Organization owner accepts terms and confirms authority to represent the organization.
4. Verification is completed using the future approved risk/verification policy.
5. Organization moves to `active`; owner membership is activated.
6. Additional users are invited later through expiring single-use invitations.

The exact legal fields, tax validation, and KYC requirements remain a business/legal decision. Do not collect national ID or tax identifiers unless necessary and approved.

### Stage C — Plan selection and checkout

1. Catalog returns only active plans and published plan versions.
2. User selects product, plan, billing cadence, scope (personal/organization), and quantity/seats.
3. Server calculates the authoritative price, currency, taxes/discount eligibility, and amount due from a versioned price record.
4. Server creates a pending order/checkout session with a unique internal order ID and idempotency key.
5. Provider checkout receives only the necessary order reference and amount. Client cannot override price, currency, product, seat count, or customer scope.
6. User is redirected to provider checkout.
7. Return URL displays a pending/processing state only. It never activates access by itself.

### Stage D — Payment verification and provisioning

1. Provider sends a signed webhook/event to a server endpoint.
2. Endpoint validates signature, timestamp/replay window, provider account, event identity, and expected order/customer/amount/currency.
3. Event is stored or queued idempotently; duplicate provider events do not create duplicate orders, payments, or licenses.
4. Server reconciles provider state with internal order and payment records.
5. Only a verified successful payment (or explicitly authorized zero-cost/trial order) may move an order to `paid`.
6. A provisioning operation creates/activates the license and entitlements using the purchased plan version.
7. For organization licenses, seat pool is created; no user is assigned automatically unless the product/plan explicitly defines a default owner seat.
8. An outbox/job delivers confirmation and updates portal catalog state.
9. User sees `active` only after server-side provisioning succeeds.

If payment succeeds but provisioning fails, retain a recoverable `paid_pending_provisioning` state, alert operations, and retry idempotently. Never ask the customer to pay again solely because provisioning timed out.

### Stage E — Seat assignment and first launch

1. Organization owner/admin opens the seat management page.
2. Server checks active license, available capacity, active membership, and assign permission.
3. Seat assignment is recorded with start/end dates and actor.
4. User sees OPS and enabled modules in their selected organization context.
5. Launch request rechecks license, entitlement, membership, role, and product permission.
6. Product backend independently enforces authorization on every protected operation.

An available seat is not itself a product permission. Product-specific roles remain separately assigned.

### Stage F — Renewal and recurring billing

1. Before renewal, notify billing contact according to configurable cadence.
2. Provider renewal event is verified and reconciled.
3. Successful renewal extends the license period without creating duplicate assignments.
4. Failed renewal moves subscription to `past_due` or `grace` according to the approved policy.
5. Grace duration is a commercial decision, not an implicit technical default.
6. At grace end, license becomes `suspended` or `expired`; server blocks new protected actions.
7. A later verified payment may reactivate according to policy and preserve historical assignment records.

### Stage G — Plan changes

**Upgrade:** calculate prorations/credit using provider or approved internal policy; create a versioned order; activate additional entitlements only after verified payment or approved credit.

**Downgrade:** schedule at period end by default. Show which modules, seats, or limits will be lost. Never silently delete customer data.

**Seat increase:** charge/contract change is verified before increasing capacity.

**Seat decrease:** cannot reduce below current assigned seats until assignments are removed or the effective date is reached. Show impact before confirmation.

**Plan migration:** keep prior plan/version on historical invoices and orders.

### Stage H — Cancellation, suspension, and offboarding

Cancellation states must distinguish:
- cancellation requested;
- cancel at period end;
- cancelled;
- access suspended for non-payment;
- access revoked for policy/security reasons.

At cancellation:
1. Confirm actor has billing authority.
2. Show effective date, refund/credit policy, seat impact, and affected users.
3. Record reason and provider cancellation reference.
4. Retain access until paid-through date unless security/policy requires immediate suspension.
5. At effective end, stop new access server-side.
6. Preserve records and provide an approved export/deletion request workflow subject to legal retention requirements.
7. Keep audit and billing history according to approved retention policy.

Closing an organization must not erase individual user identities or unrelated personal workspaces.

## 4. Product-specific commercial rules

### NOFEKI Gastos

- Free personal access in v1.
- No paid subscription required to retain the existing active Gastos user base.
- Existing users can continue using the direct Gastos URL while Platforms is introduced.
- The product's existing expense data, shortcut authorization, and financial profile remain in their current domain.
- Future paid add-ons, if any, must be separate entitlements and must not retroactively block the free core.

### NOFEKI OPS

- Paid product, licensed primarily to an organization in v1.
- License may contain a seat pool and module entitlements.
- Organization owner/admin assigns seats to active members.
- Product roles (inventory manager, buyer, analyst, viewer, etc.) are separate from license assignment.
- Access to a module requires both module entitlement and a product role/permission.
- Trial policy, seat minimums, pricing, and billing cadence remain to be approved.

### Future products

Must declare: product owner, lifecycle state, plan mapping, entitlement keys, supported scope, authorization adapter, data boundary, billing behavior, and offboarding policy before being published.

## 5. Canonical state machines

### Order
`draft → pending_checkout → pending_payment → paid → fulfilled`

Alternative terminal/recovery states: `payment_failed`, `cancelled`, `refunded`, `paid_pending_provisioning`, `fulfillment_failed`.

### Subscription
`pending → trialing → active → past_due → grace → suspended → cancelled`

An expired subscription may transition to `active` only through a verified renewal/reactivation event. State changes must follow explicit transition rules.

### License
`draft → trial|active → grace → suspended|expired → revoked|cancelled`

A license can be revoked immediately for security/policy reasons with a mandatory reason and elevated authorization. Expiration is derived from the effective period and enforced server-side.

### Seat assignment
`pending → active → suspended|ended|revoked`

Seat assignment must never outlive the license's effective access window unless explicitly modeled as scheduled.

## 6. Data and event boundaries

Proposed commercial records (logical names only; not a schema migration):
- `customers`: billing identity/reference, separate from Auth identity.
- `orders` and `order_items`: immutable purchase intent and selected price/plan version.
- `payment_attempts`: provider reference, amount, currency, status, timestamps.
- `provider_events`: provider event ID, type, signature verification result, processing status.
- `subscriptions`: cadence, period, renewal/cancellation state.
- `licenses`: product, scope, plan version, seats, effective dates, lifecycle state.
- `license_assignments`: user/organization seat assignment and history.
- `provisioning_jobs` or transactional outbox: reliable, retryable entitlement activation.
- `billing_adjustments`: refunds, credits, manual adjustments, and reason.
- `commercial_audit_events`: actor, source event, before/after, correlation ID.

These are conceptual entities. Reconcile them with the existing proposed `platform` data model before implementation; do not create duplicate or conflicting tables.

## 7. Provider adapter requirements

Provider-neutral interface should support:
- create checkout session;
- verify webhook signature;
- retrieve authoritative payment/subscription state;
- cancel or schedule cancellation;
- issue refund/credit where policy permits;
- reconcile events and transactions;
- map provider customer, payment, invoice, and subscription IDs.

Provider secret keys remain server-side. Never place them in browser code, URLs, repository files, logs, or client-visible configuration.

Webhook processing must be replay-safe, idempotent, observable, and tolerant of out-of-order events. When event order is ambiguous, fetch authoritative provider state before changing entitlements.

## 8. Customer communications

Send transactional notices for:
- invitation and organization activation;
- checkout started and payment pending;
- payment confirmed and product activated;
- trial start and upcoming trial end;
- renewal reminder and renewal result;
- payment failure and grace-period deadline;
- plan/seat change and effective date;
- cancellation confirmation and access end;
- refund or credit result.

Messages must not contain secrets, full payment credentials, or unnecessary personal data. Delivery failure must not reverse a verified payment or remove access.

## 9. Operational dashboards

Internal overview should show:
- orders by state and aging;
- payments awaiting reconciliation;
- paid orders awaiting provisioning;
- active/trial/past-due/suspended subscriptions;
- licenses expiring soon;
- seats purchased/assigned/available;
- webhook verification failures and duplicate/replayed events;
- provisioning retry queue and dead-letter items;
- refunds/credits awaiting review.

Metrics must be aggregated; support users do not need access to customer financial transaction details.

## 10. Acceptance criteria

- Browser return URL alone cannot activate a license.
- Invalid webhook signature cannot change order, payment, or entitlement state.
- Duplicate events cannot create duplicate licenses or seat assignments.
- Out-of-order events are reconciled against authoritative provider state.
- Paid-but-unprovisioned orders are recoverable without duplicate charge.
- Seat capacity cannot be exceeded under concurrent assignments.
- Organization membership removal revokes future access as designed.
- Subscription expiry and license revocation are enforced by product APIs.
- Downgrade/cancellation preview identifies impacted modules and users.
- Gastos free access and direct route remain functional.
- Audit history captures operator actions and provider-driven transitions.
- Cross-tenant purchase and assignment attempts are denied.

## 11. Decisions required before implementation

1. Payment provider and supported payment methods/currencies.
2. Colombia-first billing and tax/invoicing requirements, including legal entity and DIAN responsibilities.
3. OPS pricing, billing cadence, minimum seats, and seat transfer policy.
4. Trial eligibility, duration, conversion, and abuse controls.
5. Grace period, dunning schedule, suspension timing, and reactivation rules.
6. Refund, cancellation, proration, and downgrade policies.
7. Whether personal paid licenses are needed in v1.
8. Whether an organization owner receives a seat by default.
9. Data export, retention, and deletion policy at offboarding.
10. Transactional email provider and required templates.

No pricing, tax, refund, or legal policy is assumed by this document.
