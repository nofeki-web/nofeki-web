# NOFEKI Platforms — Admin RBAC Matrix v1

**Status:** Proposed authorization matrix; not implemented.  
**Rule:** Backend authorization is authoritative. UI visibility is never sufficient.

## 1. Role definitions

Internal roles: `platform_owner`, `platform_admin`, `product_manager`, `billing_operator`, `support_agent`, `auditor_read_only`.

Organization roles: `org_owner`, `org_admin`, `org_billing_admin`, `org_member`. These are tenant-scoped and never imply internal privileges.

Legend: **A** = allowed within scope; **R** = read-only; **Req** = may request, requires independent approval; **—** = denied. Any allowed mutation still requires reason, validation, and audit.

## 2. Internal role matrix

| Capability | Owner | Platform admin | Product manager | Billing operator | Support agent | Auditor |
|---|---:|---:|---:|---:|---:|---:|
| View platform overview | A | A | A | A | R | R |
| Read audit events | A | A | A (product scope) | A (billing scope) | R (support scope) | R |
| Assign internal roles | Req | — | — | — | — | — |
| Approve critical changes | A* | A* | — | — | — | — |
| Create/edit product metadata | A | A | A (assigned products) | — | — | — |
| Activate/retire product | Req | Req | Req | — | — | — |
| Create/edit module definitions | A | A | A (assigned products) | — | — | — |
| Manage feature flags | A | A | A (assigned products) | — | — | — |
| Create/edit plans | Req | Req | R | A (commercial fields) | — | R |
| Create/modify entitlements | Req | Req | Req (product scope) | — | — | R |
| Search users / view minimal profile | A | A | R (product scope) | R (billing scope) | R (limited) | R (limited) |
| Suspend user account | Req | Req | — | — | — | — |
| Initiate recovery email | A | A | — | — | A | — |
| Manage organizations | A | A | R (product scope) | R (billing scope) | R (limited) | R |
| Transfer organization ownership | Req | Req | — | — | — | — |
| Manage invitations/memberships | A | A | — | — | Resend only | R |
| Issue/extend trial | Req | Req | — | A (within policy) | — | R |
| Create/modify/revoke licenses | Req | Req | R | A (within policy) | — | R |
| Change seat quantity | Req | Req | — | A (within contract) | — | R |
| Bulk suspend/revoke | Req | Req | — | Req | — | R |
| View sensitive customer content | — | — | — | — | — | — |
| Impersonate customer | — | — | — | — | — | — |
| Configure break-glass | — | — | — | — | — | — |

* The requester cannot approve their own request. A second authorized person is required. For the most critical platform-wide operations, require platform_owner plus a second approver, with dual control enforced server-side.

## 3. Organization-scoped matrix

| Capability | Org owner | Org admin | Org billing admin | Org member |
|---|---:|---:|---:|---:|
| View own organization profile | A | A | R | R |
| Edit organization profile | A | A (limited) | — | — |
| Invite members | A | A | — | — |
| Revoke pending invitations | A | A | — | — |
| Remove/suspend members | A | A (policy-limited) | — | — |
| Assign existing product seats | A | A (if licensed) | — | — |
| View license usage | A | R | A | — |
| View/manage billing details | A | — | A | — |
| Transfer ownership | Req | — | — | — |
| Manage product-specific roles | A | A (if granted) | — | — |
| Access another organization | — | — | — | — |
| Access internal admin console | — | — | — | — |

Organization-owner transfer requires independent platform approval in v1. Organization roles must always be checked together with active membership and target organization ID.

## 4. Permission model

Use stable permission keys rather than hardcoded UI role checks. Proposed namespaces:

- `platform.dashboard.read`
- `platform.audit.read`
- `platform.roles.request`
- `platform.roles.approve`
- `catalog.products.read|write|publish`
- `catalog.modules.read|write|publish`
- `catalog.flags.read|write`
- `catalog.plans.read|write|publish`
- `catalog.entitlements.read|write|publish`
- `people.users.read_limited`
- `people.users.suspend.request`
- `people.recovery.initiate`
- `organizations.read|write|suspend`
- `organizations.members.read|invite|remove`
- `licenses.read|issue|change|revoke`
- `billing.read|reconcile`
- `support.events.read_limited`
- `support.invitation.resend`

Permissions must be checked against actor, scope, target, resource state, and (where applicable) approval state. Avoid broad wildcard grants.

## 5. Segregation of duties

- No self-approval.
- Role assignment and approval are separate permissions.
- Billing operators cannot grant themselves platform privileges.
- Product managers cannot change billing settlement or user security roles.
- Support agents cannot change licenses, roles, or entitlements.
- Auditors cannot mutate state.
- Organization administrators cannot administer the platform or other tenants.
- Sensitive exports require separate authorization and are outside v1.

## 6. Required authorization tests

1. A user with only `org_admin` cannot call any internal admin API.
2. An internal support agent cannot access another organization's member list unless the support case grants the explicitly scoped read.
3. A product manager assigned to Product A cannot modify Product B.
4. A billing operator cannot change internal roles or product permissions.
5. An auditor cannot invoke any mutation, even if a request is crafted manually.
6. An organization admin cannot assign seats beyond active license capacity.
7. A suspended/removed member cannot access the organization context.
8. An expired/revoked license cannot grant a new product session.
9. An actor cannot approve their own privileged request.
10. Client-supplied role, organization ID, entitlement, or price cannot override server state.

## 7. Implementation note

This matrix is a design artifact, not a database seed or executable policy. Before implementation, map each permission to the approved data model, define scope-resolution rules, write negative authorization tests, and review RLS plus server-side enforcement in an isolated environment. Do not copy this matrix into production roles without that review.
