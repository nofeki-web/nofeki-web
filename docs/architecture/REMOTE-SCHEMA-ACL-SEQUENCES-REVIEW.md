# NOFEKI — Schema ACL, Sequences, and Function Privileges Review

**Inspection:** read-only PostgreSQL catalog queries  
**Project:** `bxjgodhqseoxrnshqtfr`  
**Date:** 2026-11-07  
**Production changes:** none

## Relations outside ordinary public tables

The catalog query found these non-table relations outside system schemas:
- `public.legal_acceptance_audit_id_seq`
- Supabase-managed Auth sequence `auth.refresh_tokens_id_seq`
- Supabase-managed Realtime objects
- Supabase-managed extension/Vault views

No application view or materialized view was found in `public` during this inspection. Do not attempt to recreate or migrate Supabase-managed Auth, Realtime, Storage, Vault, or extension-owned objects as application schema.

## Identity column

`public.legal_acceptance_audit.id` is an identity column with generation mode `ALWAYS`. It is backed by `public.legal_acceptance_audit_id_seq`. This explains why its information_schema column default is null; do not add a manual nextval default.

## Schema privileges observed

- `public`: USAGE is granted to PUBLIC, anon, authenticated, postgres, and service_role; CREATE is granted to pg_database_owner.
- `auth`: USAGE is granted to anon, authenticated, postgres, service_role and Supabase administrative roles; CREATE is limited to Supabase/dashboard administrative roles.
- `extensions`: USAGE is granted to anon, authenticated, postgres, service_role and administrative roles; CREATE observed for postgres/dashboard_user.
- `graphql_public`: USAGE is granted to anon, authenticated, service_role, postgres, and Supabase administrative roles.
- `storage`: USAGE is granted to anon, authenticated, service_role, postgres and storage administrative roles; CREATE is limited to administrative roles.

This is a snapshot of effective catalog ACL entries, not a recommendation to change platform-managed schema privileges. Do not tighten or rewrite Supabase-managed schema ACLs as part of the NOFEKI Platform work without a separate impact assessment.

## Public application function ACLs

The inspected public application functions showed no explicit PUBLIC EXECUTE grant in the expanded ACL output:
- `capture_nofeki_legal_acceptance()`: postgres only; SECURITY DEFINER.
- `enforce_single_active_shortcut_authorization()`: postgres only; SECURITY DEFINER.
- `issue_shortcut_authorization(...)`: postgres and service_role; SECURITY INVOKER.
- `pqr_consume_rate_limit(...)`: postgres and service_role; SECURITY INVOKER.
- `rls_auto_enable()`: postgres only; SECURITY DEFINER.
- `save_monthly_budget(...)`: postgres and authenticated; SECURITY INVOKER.

The Supabase-managed extension and Auth function ACLs were not exhaustively reviewed here. This result is limited to public-schema application functions.

## Follow-up

- Verify default privileges for future objects in `public`.
- Confirm the public schema's intended exposure in Supabase Data API settings.
- Review function owner and EXECUTE privileges again after local schema restoration.
- Keep all Supabase-managed schemas and extension-owned objects out of the NOFEKI application baseline unless Supabase's supported local workflow generates them.

## Decision

No ACL, sequence, schema, or function privilege changes are recommended from this read-only inspection. Preserve production state.
