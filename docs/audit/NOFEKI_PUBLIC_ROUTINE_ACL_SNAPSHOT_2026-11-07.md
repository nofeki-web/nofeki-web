# NOFEKI Public Routine ACL Snapshot — 2026-11-07

**Source:** SELECT-only query against `pg_proc.proacl`, expanded with `aclexplode`, plus effective `has_function_privilege` checks in Supabase project `bxjgodhqseoxrnshqtfr`.  
**Branch:** `recovery/pqr-admin-retry-fix-20261108`.  
**No production changes.**

## Effective EXECUTE matrix

| Routine | anon | authenticated | service_role | Explicit ACL grantees observed |
|---|---:|---:|---:|---|
| `capture_nofeki_legal_acceptance()` | No | No | No | postgres |
| `enforce_single_active_shortcut_authorization()` | No | No | No | postgres |
| `issue_shortcut_authorization(uuid,text,text,timestamptz)` | No | No | Yes | postgres, service_role |
| `pqr_consume_rate_limit(text,integer,integer)` | No | No | Yes | postgres, service_role |
| `rls_auto_enable()` | No | No | No | postgres |
| `save_monthly_budget(date,text,numeric,numeric,numeric,jsonb)` | No | Yes | No | postgres, authenticated |

The effective privilege query confirms there is no inherited PUBLIC EXECUTE path for the listed routines: anon has no EXECUTE on any of them, and the three internal trigger routines are not executable by anon, authenticated, or service_role. The budget RPC is executable by authenticated only; the two backend RPCs are executable by service_role only.

## Interpretation

- This snapshot resolves the uncertainty left by the compact `information_schema.routine_privileges` view.
- Preserve the current narrow execution model when building any future restore plan.
- Trigger routines are invoked by their trigger attachments; application roles do not need direct EXECUTE grants for those routines.
- Do not widen grants to PUBLIC, anon, authenticated, or service_role merely to make a restore succeed. Any future grant change needs a separate security review.

## Scope limitation

This covers the six application routines in schema `public` observed in the live catalog. It does not inventory Supabase-managed functions in `auth`, `storage`, `extensions`, `graphql`, or platform schemas.