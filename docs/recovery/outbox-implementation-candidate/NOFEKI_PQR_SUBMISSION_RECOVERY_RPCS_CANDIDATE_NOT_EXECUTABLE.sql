-- NOFEKI PQR — submission recovery RPC candidates
-- REFERENCE ONLY. Apply only after base submission/outbox schema is validated in isolated PostgreSQL 17.
begin;
create table if not exists private.pqr_submission_recovery_audit (
 id bigint generated always as identity primary key,
 idempotency_key uuid not null,
 action text not null check (action in ('failed','uncertain','reconciled_to_failed')),
 actor text not null check (pg_catalog.length(pg_catalog.btrim(actor)) between 1 and 120),
 reason_code text not null check (reason_code ~ '^[a-z0-9_]{2,64}$'),
 created_at timestamptz not null default pg_catalog.now()
);
alter table private.pqr_submission_recovery_audit enable row level security;
revoke all on private.pqr_submission_recovery_audit from public, anon, authenticated;
grant select, insert on private.pqr_submission_recovery_audit to service_role;

create or replace function public.pqr_submit_mark_failed(p_idempotency_key uuid,p_claim_token uuid,p_reason_code text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_request private.pqr_submission_requests%rowtype;
begin
 if p_idempotency_key is null or p_claim_token is null or p_reason_code is null or p_reason_code !~ '^[a-z0-9_]{2,64}$' then raise exception 'invalid_failure_transition' using errcode='22023'; end if;
 select r.* into v_request from private.pqr_submission_requests r where r.idempotency_key=p_idempotency_key for update;
 if not found or v_request.state not in ('reserved','uploaded') or v_request.claim_token<>p_claim_token or v_request.lease_until<=pg_catalog.now() or v_request.submission_id is not null then return false; end if;
 update private.pqr_submission_requests set state='failed',claim_token=null,lease_until=null,safe_error_code=p_reason_code,updated_at=pg_catalog.now() where idempotency_key=p_idempotency_key;
 insert into private.pqr_submission_recovery_audit(idempotency_key,action,actor,reason_code) values(p_idempotency_key,'failed','edge_function',p_reason_code);
 return true;
end;
$$;

create or replace function public.pqr_submit_mark_uncertain(p_idempotency_key uuid,p_claim_token uuid,p_reason_code text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_request private.pqr_submission_requests%rowtype;
begin
 if p_idempotency_key is null or p_claim_token is null or p_reason_code is null or p_reason_code !~ '^[a-z0-9_]{2,64}$' then raise exception 'invalid_uncertain_transition' using errcode='22023'; end if;
 select r.* into v_request from private.pqr_submission_requests r where r.idempotency_key=p_idempotency_key for update;
 if not found or v_request.state not in ('reserved','uploaded') or v_request.claim_token<>p_claim_token or v_request.submission_id is not null then return false; end if;
 update private.pqr_submission_requests set state='uncertain',claim_token=null,lease_until=null,safe_error_code=p_reason_code,updated_at=pg_catalog.now() where idempotency_key=p_idempotency_key;
 insert into private.pqr_submission_recovery_audit(idempotency_key,action,actor,reason_code) values(p_idempotency_key,'uncertain','edge_function',p_reason_code);
 return true;
end;
$$;

create or replace function public.pqr_submit_reconcile_uncertain(p_idempotency_key uuid,p_actor text,p_reason_code text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_request private.pqr_submission_requests%rowtype;
begin
 if p_idempotency_key is null or p_actor is null or pg_catalog.length(pg_catalog.btrim(p_actor)) not between 1 and 120 or p_reason_code is null or p_reason_code !~ '^[a-z0-9_]{2,64}$' then raise exception 'invalid_reconciliation_request' using errcode='22023'; end if;
 select r.* into v_request from private.pqr_submission_requests r where r.idempotency_key=p_idempotency_key for update;
 if not found or v_request.state<>'uncertain' or v_request.submission_id is not null then return false; end if;
 if v_request.storage_object_path is not null and exists(select 1 from public.pqr_submissions s where s.attachment_path=v_request.storage_object_path) then raise exception 'submission_attachment_reference_found' using errcode='23514'; end if;
 update private.pqr_submission_requests set state='failed',safe_error_code=p_reason_code,updated_at=pg_catalog.now() where idempotency_key=p_idempotency_key;
 insert into private.pqr_submission_recovery_audit(idempotency_key,action,actor,reason_code) values(p_idempotency_key,'reconciled_to_failed',pg_catalog.btrim(p_actor),p_reason_code);
 return true;
end;
$$;

revoke all on function public.pqr_submit_mark_failed(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.pqr_submit_mark_uncertain(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.pqr_submit_reconcile_uncertain(uuid,text,text) from public,anon,authenticated;
grant execute on function public.pqr_submit_mark_failed(uuid,uuid,text) to service_role;
grant execute on function public.pqr_submit_mark_uncertain(uuid,uuid,text) to service_role;
grant execute on function public.pqr_submit_reconcile_uncertain(uuid,text,text) to service_role;
commit;
-- No Storage deletion is performed here. Cleanup remains a separate audited process.
-- The actor must be derived by an authenticated/authorized backend, never trusted from browser input.