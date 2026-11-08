# NOFEKI — Inventario consolidado de objetos de producción
Fecha: 2026-11-07
Proyecto: `bxjgodhqseoxrnshqtfr`
Método: consultas de catálogo PostgreSQL de solo lectura.

## Tablas del esquema public
Las 12 tablas inspeccionadas tienen RLS habilitado y FORCE RLS deshabilitado:

| Tabla | Modelo de acceso observado |
|---|---|
| budget_categories | CRUD autenticado con comprobación de propiedad del presupuesto |
| budgets | CRUD autenticado restringido por user_id |
| financial_profiles | Datos de perfil financiero; RLS habilitado |
| gastos | Datos de gastos por usuario; RLS habilitado |
| income_transactions | CRUD autenticado restringido por user_id |
| legal_acceptance_audit | Lectura propia; inserción controlada por trigger |
| pqr_events | Sin policies directas; operaciones internas |
| pqr_rate_limits | Sin policies directas; operaciones internas |
| pqr_submissions | Sin policies directas; operaciones internas |
| shortcut_authorizations | Sin policies directas; operaciones internas |
| shortcut_link_codes | Sin policies directas; operaciones internas |
| user_expense_categories | CRUD autenticado bajo propiedad; SELECT de service_role |

Las cinco tablas internas sin policies directas deben seguir accesibles solo mediante funciones privilegiadas que validen el contexto correspondiente. No exponer service_role ni crear policies amplias para resolver errores.

## Objetos destacados
- `budgets`: unicidad usuario/mes, modo income/manual, importes no negativos y mes normalizado al día 1.
- `budget_categories`: FK compuesta (budget_id,user_id), nombre de 1–80 caracteres, importe >= 0, unicidad por presupuesto/nombre.
- `gastos`: monto > 0, tipo Necesario/Discrecional/Deuda, source web/shortcut/import, idempotencia por usuario y clave.
- `income_transactions`: monto > 0, concepto 2–120, nota <=500 y source <=80.
- `pqr_submissions`: referencia única, tipos/estados acotados, límites de nombre/asunto/mensaje/email y estado de notificación.
- `pqr_events`: FK a PQR, eventos acotados y estados de correo permitidos.
- Índices relevantes: presupuestos por usuario/mes, categorías por presupuesto/usuario, ingresos por usuario/fecha/id, PQR por referencia/fecha/source y eventos por solicitud/fecha.
- El índice `budget_categories_budget_user_fk_idx` existe en producción y requiere identificar su procedencia histórica.

## Funciones PostgreSQL
| Función | Seguridad | Observación |
|---|---|---|
| capture_nofeki_legal_acceptance | DEFINER, search_path vacío | Trigger de auditoría; metadata editable no debe usarse como autorización |
| enforce_single_active_shortcut_authorization | DEFINER, search_path public | Revoca otras autorizaciones activas al insertar |
| issue_shortcut_authorization | INVOKER, search_path vacío | Emisión atómica con lock por usuario; ejecución service_role |
| pqr_consume_rate_limit | INVOKER, search_path vacío | Contador atómico; ejecución service_role |
| save_monthly_budget | INVOKER, search_path vacío | Requiere auth.uid(); guarda presupuesto/categorías atómicamente |
| rls_auto_enable | DEFINER, search_path pg_catalog | Función asociada al event trigger ensure_rls |

## Triggers
- `trg_single_active_shortcut_authorization`: AFTER INSERT sobre `shortcut_authorizations`.
- `ensure_rls`: event trigger ddl_command_end, habilitado, owner postgres; ejecuta `rls_auto_enable`. Ver snapshot de esquema para el detalle catalogado.

## Storage PQR
- Bucket `pqr-attachments`: privado; límite 5 MB; MIME PDF, JPEG y PNG.
- `storage.objects`: RLS habilitado y sin policies directas observadas.
- `pqr-submit` usa service_role para upload y cleanup de adjuntos.
- `pqr-admin` genera URL firmada por 300 segundos para consulta autorizada.
- Riesgo residual: no se ejecutó prueba funcional de carga, descarga, expiración o acceso cruzado. Confirmar autorización admin antes de firmar URL en todos los caminos.

## Límites
Este inventario es una fotografía del catálogo observado. No es un dump completo ni una migración reproducible. No incluye definición completa de vistas, extensiones, grants por columna, configuración privada del proyecto ni todos los datos. No ejecutar SQL derivado de este documento sin una fase separada de diseño, revisión y aprobación.
