# NOFEKI Platforms — Admin Console Specification v1

**Status:** Architecture proposal; not implemented.  
**Scope:** Internal NOFEKI administration and delegated organization administration.  
**Safety:** Documentation only. No production, Auth, database, Edge Function, RLS, Vercel, or deployment changes are authorized by this specification.

## 1. Purpose and boundary

The Admin Console is an operational control plane for the NOFEKI ecosystem. It is not the customer launcher described in the Portal UX specification.

- **Customer portal:** lets an authenticated person discover and launch products available to their personal or organizational context.
- **Internal Admin Console:** lets authorized NOFEKI staff manage catalog configuration, plans, entitlements, licenses, support workflows, and platform operations.
- **Organization workspace administration:** lets explicitly delegated organization administrators manage only their own organization's members, invitations, and permitted assignments.

These surfaces must have separate navigation, authorization policies, API scopes, and audit trails. A customer organization administrator is not an internal NOFEKI administrator.

## 2. Design principles

1. Deny by default; grant the smallest permission needed.
2. Enforce authorization on the server for every read and write. Hiding a UI control is not authorization.
3. Derive the actor from a validated session; never accept actor identity or role from client-supplied metadata.
4. Enforce tenant boundaries in every query and mutation.
5. Require a reason for privileged mutations and record before/after state, actor, timestamp, target, request/correlation ID, and outcome.
6. Prefer reversible state transitions over destructive deletion.
7. Separate configuration from runtime entitlements; changes must be versioned and take effect predictably.
8. Protect customer data: support views expose operational metadata by default, not expense records, passwords, tokens, or secrets.
9. No impersonation in v1. Support staff must not silently act as a customer.
10. Existing NOFEKI Gastos must remain directly accessible if Platforms or the Admin Console is unavailable.

## 3. Actors and security domains

### 3.1 Internal platform roles

- `platform_owner`: platform-wide accountable owner. May assign internal roles and approve critical operations. No routine use for daily support.
- `platform_admin`: manages users, organizations, product catalog, module configuration, and operational settings within granted scopes. Cannot self-grant owner privileges or approve their own critical changes.
- `product_manager`: manages assigned product metadata, module catalog, release status, feature flags and product-level entitlements. Cannot manage internal staff or billing settlement.
- `billing_operator`: manages plans, subscriptions, invoices/payment references, trials, license issuance and billing reconciliation. Cannot alter security roles or grant platform-wide admin permissions.
- `support_agent`: reads limited account, membership, license and event metadata; may perform approved low-risk support actions such as resending an invitation or requesting a password recovery email. Cannot view passwords, session tokens, expense content, or change entitlements.
- `auditor_read_only`: read-only access to scoped audit, configuration history and operational evidence. Cannot mutate or export sensitive customer content.

Internal roles are assigned only through a controlled server-side process. A user cannot become an internal operator by editing profile fields, JWT user metadata, browser storage, or API payloads.

### 3.2 Organization roles

Organization roles are independent of internal roles:

- `org_owner`: manages organization profile, delegated administrators, members, and organization-level product access within contractual limits.
- `org_admin`: manages members and invitations; may assign existing seats if allowed by the license.
- `org_billing_admin`: reads billing information and manages payment-related settings only.
- `org_member`: accesses products and modules granted to their membership.
- Product-specific roles (for example OPS roles) govern actions inside that product and do not imply platform administration.

Organization administrators may only operate within organizations where they have an active membership and the corresponding permission.

## 4. Console information architecture

1. **Overview:** platform health summary, pending approvals, expiring licenses, invitation issues, and recent administrative events.
2. **Catalog:** products, modules, plans, entitlement definitions, release states, and feature flags.
3. **People:** user lookup, profile status, organization memberships, and account support actions.
4. **Organizations:** organization records, owners, members, invitations, and lifecycle state.
5. **Licensing & Billing:** licenses, seat pools, assignments, trials, renewals, suspensions, and billing references.
6. **Support:** scoped event timeline, issue classification, safe account actions, and escalation.
7. **Audit & Security:** immutable audit-event viewer, approval queue, privileged-role assignments, and break-glass history.
8. **Settings:** controlled platform configuration, notification policies, and operator access review.

Navigation and data returned by each screen must be filtered by server-authorized scope.

## 5. Catalog and product lifecycle

Products and modules have stable machine keys, display names, descriptions, owners, lifecycle state, and version metadata.

Lifecycle states:
- `draft`: editable configuration; not discoverable or launchable by customers.
- `active`: available according to entitlement and permission checks.
- `suspended`: temporarily blocked from new launches; existing sessions follow a documented product policy.
- `retired`: no new grants or assignments; historical records remain readable for audit.

A module may be active only when its parent product is active. A plan may reference only published entitlement definitions. Changes create a new configuration version; do not silently rewrite historical license terms. Feature flags are scoped by product/module and optionally organization or controlled cohort. Flags are not authorization: backend permission checks remain mandatory.

## 6. People and organization management

### User operations
- Search by verified email or immutable user UUID, with rate limits and access logging.
- View minimal profile, account creation/status metadata, memberships, active product grants, and recent security events.
- Support account recovery by initiating the established recovery flow; never set or reveal a password.
- Account suspension requires a reason, impact preview, and confirmation. Prefer reversible suspension over deletion.
- No v1 impersonation, session hijacking, token display, or direct editing of Auth internals.

### Organization operations
- Create organization in `pending` state; verify ownership/contact before activation.
- Lifecycle: `pending`, `active`, `suspended`, `closed`.
- Invite members using expiring, single-use invitations; store only a secure token hash.
- Invitation states: `pending`, `accepted`, `expired`, `revoked`.
- Membership states: `invited`, `active`, `suspended`, `removed`.
- Enforce one active membership per user/organization pair unless a future documented model explicitly permits multiple membership records.
- Removing a member revokes future access and assignments according to a defined transaction; preserve audit history.
- Organization closure is a controlled lifecycle transition, not physical deletion.

## 7. License and entitlement operations

License record fields should include product, scope (personal or organization), plan/version, seat quantity, start/end timestamps, state, source/reference, and responsible operator.

License states: `draft`, `trial`, `active`, `grace`, `suspended`, `expired`, `revoked`, `cancelled`.

Rules:
- Seat assignments cannot exceed available capacity.
- Assignment requires an active membership for organization-scoped licenses.
- Trial conversion, extension, suspension, revocation, and seat-count changes require a reason and audit event.
- Expiration and revocation are enforced server-side at authorization time, not only by portal display.
- Revocation blocks new actions promptly; product-specific session/token invalidation behavior must be specified and tested.
- Billing events are idempotent and reconciled against provider references; do not infer paid status from a browser redirect.
- Preserve historical license terms and assignment history.

## 8. Support and observability

Support can inspect event metadata such as event type, timestamp, product, request ID, result code, and sanitized error category. Default support views must exclude expense descriptions, financial amounts, uploaded PQR attachments, authentication secrets, access tokens, and raw request bodies.

Sensitive access, if ever justified, requires a separate approved workflow, narrowly scoped access, explicit reason, time limit, and audit event. It is not part of v1.

## 9. Critical operations and approvals

Require a second authorized approver for:
- granting or changing internal privileged roles;
- creating or changing platform-wide plans or entitlements;
- issuing or revoking high-value/platform-wide licenses;
- organization ownership transfer;
- bulk suspension, bulk seat changes, or bulk membership removal;
- emergency access or break-glass activation.

The requester cannot approve their own request. Approval records capture request, approver, decision, reason, expiry, and resulting operation. For low-risk reversible operations, a single authorized operator may act with mandatory reason and audit logging.

### Break-glass

Not enabled in v1. Future design must require a declared incident, time-limited elevation, strongest available authentication, alerting, scoped permissions, mandatory reason, immutable audit trail, and post-incident review. Break-glass must not be a permanent hidden administrator account.

MFA for internal operators is a target security requirement before broad operational rollout. This specification does not change the current Auth configuration.

## 10. Server-side API contract principles

All endpoints are conceptual until separately designed and reviewed. Mutations must:
- validate session and internal/organization role server-side;
- validate target scope and current state;
- validate reason and approval requirement;
- use idempotency keys for retryable operations;
- perform state transition atomically;
- emit an audit event in the same transaction or a reliable outbox;
- return stable error codes without leaking sensitive details.

Suggested error families: `AUTH_REQUIRED`, `ADMIN_ROLE_REQUIRED`, `SCOPE_FORBIDDEN`, `APPROVAL_REQUIRED`, `APPROVAL_INVALID`, `REASON_REQUIRED`, `STATE_CONFLICT`, `SEAT_LIMIT_EXCEEDED`, `LICENSE_NOT_ACTIVE`, `IDEMPOTENCY_CONFLICT`.

No endpoint may trust a role, organization ID, product permission, price, or entitlement asserted only by the client.

## 11. Audit event minimum

Every administrative mutation records:
- event ID and UTC timestamp;
- actor user UUID and effective role;
- action and target type/ID;
- scope (platform, product, organization);
- reason/ticket/reference;
- before/after values with secrets and personal data redacted;
- approval request and approver when applicable;
- request/correlation ID, source channel, outcome and error class.

Audit records are append-only to normal operators. Retention, export, legal hold, and deletion policy require a separate privacy/legal review.

## 12. Acceptance criteria

- Internal and organization roles cannot be confused or escalated through client data.
- Every mutation is authorized server-side and audited.
- Cross-organization access tests deny by default.
- Seat capacity, license dates, state transitions, and idempotency are enforced.
- Support cannot view financial transaction content or secrets by default.
- Critical operations require an independent approver.
- No v1 impersonation or permanent break-glass access exists.
- Portal/Admin Console outage does not block direct access to existing NOFEKI Gastos.
- All operations have explicit confirmation, reason capture, and clear impact preview.
- All privileged screens and APIs are tested for authorization, tenant isolation, concurrency, and audit completeness before release.

## 13. Explicit v1 exclusions

No production implementation, schema migration, Auth change, MFA rollout, payment-provider integration, impersonation, bulk destructive tooling, customer-data browsing, or automatic suspension policy is included. Those require separate decisions, threat modeling, isolated testing, and explicit release approval.

## 14. Decisions to validate before implementation

1. Legal entity and verification process for organization ownership.
2. Which internal roles may create licenses versus approve them.
3. Whether billing operator can issue manual courtesy trials and maximum duration.
4. Required audit retention and access review cadence.
5. Whether product managers can target feature flags to individual organizations.
6. Support SLA and escalation model.
