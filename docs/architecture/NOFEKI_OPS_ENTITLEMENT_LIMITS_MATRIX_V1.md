# NOFEKI OPS — Entitlement & Limits Matrix v1

**Status:** Proposed mapping to validate against actual product scope. Not an executable seed or authorization policy.

## 1. Plan limits

| Limit / entitlement | Essential | Growth | Scale |
|---|---:|---:|---:|
| Active seats | 3 | 10 | 25 |
| Active warehouses | 1 | 3 | 10 |
| Inventory catalog | Included | Included | Included |
| Stock movements | Included | Included | Included |
| Basic min/max | Included | Included | Included |
| Basic ABC / rotation | Included | Included | Included |
| Purchasing workflow | No | Included | Included |
| Multi-warehouse transfers | No | Included | Included |
| Advanced analytics | No | No | Included |
| Approval workflows | No | Basic | Advanced |
| API access | No | Limited | Higher quota |
| Custom ERP/SAP integration | Quoted separately | Quoted separately | Quoted separately |

## 2. Entitlement keys

- `ops.seats.max`
- `ops.warehouses.max`
- `ops.inventory.core`
- `ops.inventory.movements`
- `ops.replenishment.basic`
- `ops.analytics.abc_rotation`
- `ops.purchasing.core`
- `ops.warehouse.multi_location`
- `ops.analytics.advanced`
- `ops.approvals.basic`
- `ops.approvals.advanced`
- `ops.api.enabled`
- `ops.api.monthly_quota`
- `ops.integrations.custom`

Numeric limits should be typed values with explicit units and versioned plan definitions. Do not encode numeric limits as strings or infer them from plan names.

## 3. Authorization resolution

Allow a protected operation only if all are true:
1. User is authenticated.
2. Selected organization is active and user has active membership.
3. Organization has active OPS license or approved trial.
4. Required module entitlement is active.
5. Seat assignment is active if the plan requires a seat.
6. Product role grants the required permission.
7. License/entitlement effective period includes current server time.
8. Organization and license are not suspended/revoked.

The backend must perform these checks; portal state is display-only.

## 4. Limit enforcement

- Seat limit: atomic count-and-assign transaction.
- Warehouse limit: enforce on create/reactivate; historical inactive records remain.
- API quota: server-side rate/usage accounting by license and period.
- Trial expiry: server-side timestamp check; never trust client clock.
- Plan downgrade: schedule effective date and preflight impact.
- Module revocation: invalidate new API operations; define session/cache refresh and test it.

## 5. Open questions

Confirm if the initial OPS build actually supports purchasing, transfers, approval workflows, API quotas, and advanced analytics. If not, mark them roadmap-only and do not include them in saleable plans until implemented and tested.
