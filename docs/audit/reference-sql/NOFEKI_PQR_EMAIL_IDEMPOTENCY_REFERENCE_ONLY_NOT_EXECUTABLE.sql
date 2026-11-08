-- NOFEKI PQR — SQL de referencia, NO EJECUTAR
-- Rama: recovery/pqr-admin-retry-fix-20261108
-- Estado: diseño no probado. No es una migración.
-- Requiere revisión de tipos reales, ACL, retención y pruebas en DB aislada.
--
-- Objetivo: reservar una clave idempotente antes de cualquier llamada a Resend.
-- La tabla debe permanecer interna: sin acceso CRUD de anon/authenticated.
-- Conceder únicamente los privilegios mínimos al rol de backend que invoque RPC.
--
-- 1) Tabla propuesta
create table if not exists public.pqr_email_operations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.pqr_submissions(id) on delete restrict,
  operation_type text not null check (operation_type in (
    'response', 'initial_confirmation', 'internal_notification', 'retry_notification'
  )),
  idempotency_key uuid not null unique,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('reserved','sending','sent','failed','uncertain')),
  provider_message_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists pqr_email_operations_submission_created_idx
  on public.pqr_email_operations (submission_id, created_at desc);
create index if not exists pqr_email_operations_status_updated_idx
  on public.pqr_email_operations (status, updated_at);
alter table public.pqr_email_operations enable row level security;
-- Intencionalmente sin policies para anon/authenticated.
-- ACL exacta pendiente de validar con el modelo de invocación elegido.
--
-- 2) Contrato de reserva atómica (pseudocódigo SQL; adaptar y probar antes de uso)
-- reserve_pqr_email_operation(
--   p_submission_id uuid, p_operation_type text, p_idempotency_key uuid,
--   p_payload_hash text, p_created_by text
-- ) returns {decision, operation_id, status}
--
-- INSERT status='reserved', attempt_count=0
-- ON CONFLICT(idempotency_key) DO NOTHING
-- RETURNING id,status.
-- Si insertó: decision='claimed'. Solo ese caller puede llamar a Resend.
-- Si no insertó: SELECT existente por idempotency_key.
--   hash distinto o submission/type distinto -> 'key_conflict' (HTTP 409).
--   status='sent' -> 'already_sent'.
--   status='uncertain' -> 'uncertain' (bloquear envío).
--   status in ('reserved','sending') -> 'in_progress'.
--   status='failed' -> 'failed'; no reusar la clave. Un reintento manual crea
--   una clave nueva y un registro nuevo enlazado por referencia explícita
--   (añadir parent_operation_id nullable antes de implementar retry).
--
-- 3) Contrato de transición
-- mark_pqr_email_sending(operation_id): reserved -> sending; incrementa attempt_count.
-- finish_pqr_email_operation(operation_id, outcome, provider_message_id, safe_error_code):
--   sending -> sent | failed | uncertain.
--   sent requiere confirmación inequívoca del proveedor y fija sent_at.
--   timeout/desconexión/respuesta ambigua => uncertain, nunca failed por inferencia.
--   sent es terminal; no permitir transición de sent a otro estado.
--   uncertain no puede volver a sending sin conciliación administrativa auditada.
--
-- 4) Seguridad y transacciones
-- - SECURITY INVOKER preferido; search_path fijo/seguro si la función usa nombres no cualificados.
-- - No SECURITY DEFINER para sortear permisos/RLS.
-- - EXECUTE solo al rol backend elegido; revocar EXECUTE de PUBLIC, anon y authenticated.
-- - Si el backend es service_role, confirmar ACL de tabla y que la clave nunca llegue al navegador.
-- - No guardar cuerpo del correo, bearer token, API key ni datos personales adicionales.
-- - Las RPC de status deben actualizar pqr_submissions y añadir pqr_events en la MISMA transacción.
-- - No mantener una transacción abierta durante la llamada HTTP a Resend.
--
-- 5) Bloqueos antes de implementación
-- - Confirmar tipo real de pqr_submissions.id y formato de reference_code.
-- - Definir parent_operation_id y reglas de retry.
-- - Definir limpieza/retención y conciliación de uncertain.
-- - Confirmar si Resend soporta idempotency keys en el endpoint usado y su ventana.
-- - Ejecutar pruebas de carrera, rollback, ACL y RLS en DB aislada.
--
-- Este archivo es documentación de referencia. NO pegar en SQL Editor de producción.
