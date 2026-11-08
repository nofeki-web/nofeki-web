# NOFEKI — Procedencia de índice y paquete SQL de referencia (2026-11-07)

## 1. Índice adicional de presupuesto
Índice observado en producción: `budget_categories_budget_user_fk_idx`, asociado a `budget_categories` y su relación compuesta con `budgets(id,user_id)`.

Se buscó el nombre exacto en el repositorio `nofeki-web/nofeki-web` mediante GitHub code search; no hubo coincidencias (la búsqueda reportó resultados incompletos). No se puede atribuir su origen a una migración/commit concreto con la evidencia actual. Tampoco debe inferirse que sea redundante: puede respaldar el FK compuesto y evitar scans al borrar/actualizar la tabla padre.

**Decisión:** conservarlo. No recrear, renombrar ni eliminar. Próximo paso para atribución: revisar clones/forks/commits eliminados y respaldos históricos; comparar definición completa, columnas y orden con los índices de la tabla.

## 2. Paquete SQL de referencia — advertencia
Este documento no es una migración. No copiarlo a `supabase/migrations/` ni ejecutarlo en producción. El historial contiene 13 migraciones remotas sin fuente original recuperada y varias equivalencias solo estructurales. Un script parcial podría duplicar objetos, perder grants, políticas, índices, triggers o dependencias.

## 3. Definiciones recuperadas desde catálogo
Las siguientes funciones se recuperaron con `pg_get_functiondef` en producción y se documentaron como evidencia de referencia:
- `public.save_monthly_budget(date,text,numeric,numeric,numeric,jsonb)` — SECURITY INVOKER; exige `auth.uid()`, valida periodo/modo/importes/categorías y guarda presupuesto/categorías de forma transaccional.
- `public.issue_shortcut_authorization(uuid,text,text,timestamptz)` — SECURITY INVOKER; valida argumentos, advisory lock por usuario, revoca expiradas, evita una segunda autorización activa e inserta el hash.
- `public.pqr_consume_rate_limit(text,int,int)` — SECURITY INVOKER; valida hash/límites y actualiza contador atómicamente.
- `public.capture_nofeki_legal_acceptance()` — SECURITY DEFINER, search_path vacío; trigger de auditoría legal, lee raw_user_meta_data solo como metadata de captura, no como autorización.
- `public.enforce_single_active_shortcut_authorization()` y `public.rls_auto_enable()` — SECURITY DEFINER; rutinas internas.

No se incluye aquí un script de reconstrucción integral porque todavía no se ha reconciliado la definición exacta de cada tabla, constraint, índice, política, trigger, grant, default privilege, extensión y dependencia. El siguiente artefacto seguro debe ser un paquete por objeto, con procedencia, hash y dependencias, separado en: esquema, seguridad, funciones, triggers e índices.

## 4. Estado de reconciliación
- Producción consultada en solo lectura.
- Índice adicional conservado, origen no atribuido.
- No se creó archivo SQL ejecutable ni migración.
- No se aplicaron DDL, grants, cambios RLS, funciones, triggers ni índices.