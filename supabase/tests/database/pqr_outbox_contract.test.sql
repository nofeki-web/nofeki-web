-- NOFEKI PQR Outbox — structural contract tests (pgTAP)
-- Candidate test. Run ONLY after applying candidate SQL to an isolated DB.
-- Supabase CLI: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select has_schema('private', 'private schema exists');
select has_table('private', 'pqr_admin_requests', 'admin idempotency table exists');
select has_table('private', 'pqr_outbox', 'outbox table exists');
select has_column('public', 'pqr_submissions', 'version', 'optimistic version exists');
select has_column('public', 'pqr_submissions', 'notification_status', 'notification status exists');
select has_column('public', 'pqr_submissions', 'notification_sent_at', 'notification timestamp exists');
select has_column('public', 'pqr_submissions', 'notification_error', 'notification error exists');

select function_returns('public', 'pqr_admin_transition_status', ARRAY['uuid','text','bigint','text','uuid','text','text','text'], 'jsonb');
select function_returns('public', 'pqr_admin_create_response', ARRAY['uuid','bigint','uuid','text','text','text'], 'jsonb');
select function_returns('public', 'pqr_admin_add_note_v2', ARRAY['uuid','uuid','text','text','text'], 'jsonb');
select function_returns('public', 'pqr_admin_retry_notification_v2', ARRAY['uuid','uuid','text','text'], 'jsonb');
select function_returns('public', 'pqr_outbox_claim', ARRAY['integer','integer'], 'record');
select function_returns('public', 'pqr_outbox_finish', ARRAY['uuid','uuid','text'], 'boolean');
select function_returns('public', 'pqr_outbox_retry', ARRAY['uuid','uuid','text','integer'], 'text');

select ok(not pg_catalog.has_function_privilege('anon', 'public.pqr_admin_create_response(uuid,bigint,uuid,text,text,text)', 'EXECUTE'), 'anon cannot execute formal response RPC');
select ok(not pg_catalog.has_function_privilege('authenticated', 'public.pqr_admin_create_response(uuid,bigint,uuid,text,text,text)', 'EXECUTE'), 'authenticated cannot execute formal response RPC');
select ok(pg_catalog.has_function_privilege('service_role', 'public.pqr_admin_create_response(uuid,bigint,uuid,text,text,text)', 'EXECUTE'), 'service_role can execute formal response RPC');
select ok(not pg_catalog.has_table_privilege('anon','private.pqr_outbox','SELECT'), 'anon cannot read private outbox');
select ok(not pg_catalog.has_table_privilege('authenticated','private.pqr_admin_requests','SELECT'), 'authenticated cannot read admin idempotency table');

select * from finish();
rollback;
