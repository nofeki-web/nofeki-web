# NOFEKI — ACL extendidas y metadatos de Storage (captura complementaria)

**Fecha de captura:** 2026-11-08  
**Proyecto:** `bxjgodhqseoxrnshqtfr` (PostgreSQL 17.11, ACTIVE_HEALTHY)  
**Método:** consultas SELECT al catálogo; no se consultaron filas de negocio ni se modificó producción.

## 1. Privilegios de schema

Roles comprobados: `anon`, `authenticated`, `service_role`.

| Schema | USAGE | CREATE |
|---|---:|---:|
| auth | sí | no |
| public | sí | no |
| storage | sí | no |

El schema `platform` no existe en el catálogo inspeccionado en esta captura.

## 2. Privilegios extendidos de tablas públicas

Se comprobaron TRUNCATE, REFERENCES y TRIGGER para las 12 tablas públicas.

- `TRUNCATE`: no aparece concedido a `anon` ni a `authenticated`; está concedido a `service_role` en las 12 tablas.
- `REFERENCES` y `TRIGGER`: aparecen concedidos explícitamente a `anon`, `authenticated` y `service_role` en `budget_categories`, `budgets` e `income_transactions`.
- En las otras nueve tablas, esos privilegios extendidos aparecen para `service_role`, pero no para `anon` ni `authenticated`.
- Ninguna de las concesiones listadas es grantable.

**Observación de seguridad:** las concesiones REFERENCES/TRIGGER para anon y authenticated en esas tres tablas son inusuales y no necesarias para el CRUD normal de NOFEKI Gastos. No equivalen por sí mismas a permisos SELECT/INSERT/UPDATE/DELETE ni demuestran una exposición de filas. Deben revisarse contra el historial de migraciones y el uso real antes de decidir revocarlas. No se revocaron en esta fase.

## 3. Storage — bucket PQR

Lectura directa de `storage.buckets`:

| Campo | Valor |
|---|---|
| id / name | `pqr-attachments` |
| public | false |
| file_size_limit | 5,242,880 bytes (5 MiB) |
| allowed_mime_types | `application/pdf`, `image/jpeg`, `image/png` |

El valor confirma el bucket privado y su límite/MIME configurados. No se realizó upload, download, cleanup ni prueba de signed URL; esas pruebas siguen TEST-PENDING y deben usar un entorno aislado con archivos sintéticos.

## 4. Configuración de Auth y límites de captura

El conector de proyecto confirmó el identificador, región `us-east-1`, estado `ACTIVE_HEALTHY` y PostgreSQL 17.11. No expuso el detalle de configuración del proveedor Auth (confirmación de correo, expiración JWT, URLs de redirect, SMTP, protección de contraseñas filtradas, MFA ni límites) ni los parámetros operativos completos de Storage.

Por tanto, esos ajustes se marcan **UNVERIFIED — requiere export/inspección del panel de configuración o Management API autorizada**. No se infieren valores ni se presentan como validados.

## 5. Cobertura y límites

- RLS: 12/12 tablas públicas habilitadas; FORCE RLS 0/12.
- Policies: 24 en 7 tablas públicas; no se encontraron policies directas en las cinco tablas internas PQR/Shortcut.
- Se verificó el conteo agregado de policies en schemas public/storage: 24. Esto no sustituye el snapshot con expresiones exactas.
- Las comprobaciones `has_table_privilege` reflejan privilegios efectivos; la inspección `aclexplode` se utilizó para distinguir concesiones directas de ACL predeterminadas.
- No se ejecutaron GRANT, REVOKE, ALTER, DDL, DML ni operaciones de Storage.

## 6. Acciones pendientes

1. Revisar la procedencia de REFERENCES/TRIGGER en las tres tablas señaladas; no revocar hasta comprobar el origen.
2. Obtener configuración Auth completa por export autorizado, sin extraer secretos.
3. Obtener configuración de Storage y políticas operativas desde el panel/Management API.
4. Restaurar y probar únicamente en instancia aislada, cuando se apruebe explícitamente su costo.
