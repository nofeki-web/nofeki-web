# NOFEKI PQR — RPC de radicación inicial y saga de Storage
Fecha: 2026-11-09
Rama: `recovery/pqr-admin-retry-fix-20261108`
Estado: contrato de implementación; no es migración ni se ha ejecutado.

## 1. Objetivo

Convertir el POST público de PQR en una operación idempotente que:
- devuelve el mismo radicado ante reintentos de la misma solicitud;
- rechaza la reutilización de clave con contenido distinto;
- crea historial inicial y dos eventos Outbox en la misma transacción que el radicado;
- maneja el adjunto como saga compensatoria, porque Storage no participa en la transacción PostgreSQL.

## 2. Contrato del cliente

El formulario crea un UUID una sola vez al iniciar el envío. Conserva esa clave durante los reintentos de red de esa misma operación. No crea una clave nueva dentro de cada llamada `fetch`.

Header requerido: `Idempotency-Key: <UUID>`.
El cliente no envía fingerprint confiable. El servidor calcula SHA-256 del contenido canónico.

Si el usuario modifica cualquier campo o adjunto después de un fallo, se considera una nueva operación y se genera otra clave tras confirmación.

## 3. Datos canónicos y fingerprint

El servidor normaliza y valida:
- nombre, email, teléfono y tipo/categoría de solicitud;
- asunto y descripción;
- aceptación/versión de consentimiento;
- metadatos del adjunto: nombre normalizado, MIME permitido, tamaño y SHA-256 calculado sobre bytes decodificados.

El fingerprint se calcula en servidor con serialización canónica versionada (por ejemplo, `pqr-submit:v1:<JSON canónico>`). No usar concatenación ambigua de campos. No incluir datos volátiles como timestamp de recepción o IP.

La clave queda ligada al fingerprint. Misma clave + mismo fingerprint reproduce la operación; misma clave + fingerprint distinto devuelve HTTP 409.

## 4. Reserva durable previa a Storage

Crear una tabla privada de solicitudes de radicación con, como mínimo:
- `idempotency_key uuid primary key`;
- `request_fingerprint text` (64 hex);
- `state` restringido a `reserved | uploaded | completed | failed | uncertain`;
- `submission_id uuid null`;
- `storage_object_path text null`;
- `attachment_sha256 text null`;
- `created_at`, `updated_at`, `completed_at`;
- `safe_error_code text null`.

La reserva se crea mediante RPC transaccional con UNIQUE sobre la clave. La respuesta de reserva distingue `claimed`, `replay`, `in_progress`, `key_conflict`, `uncertain` y `failed`. Solo `claimed` permite avanzar.

No guardar el base64 del archivo en la tabla ni duplicar PII innecesariamente.

## 5. Saga del adjunto

1. Validar Turnstile, origen/CORS, rate limit, campos, tipo real y tamaño antes de permitir la operación.
2. Calcular fingerprint en servidor.
3. Reservar la clave de idempotencia de forma atómica.
4. Si el resultado es replay/completado, devolver el radicado original sin volver a subir ni encolar correos.
5. Para `claimed`, usar ruta determinística y no sobrescribible, ligada a la operación (no solo al número visible del radicado).
6. Subir con `upsert:false`. Si ya existe por un intento anterior, no asumir que es el archivo correcto: verificar hash/metadata mediante lectura segura; reutilizar solo si coincide exactamente.
7. Finalizar mediante RPC que crea el radicado, evento inicial y dos filas Outbox, y marca la reserva `completed` en una única transacción.
8. Si Storage tuvo éxito pero la finalización DB falla, conservar la reserva para recuperación. Un proceso compensatorio puede borrar el objeto solo después de comprobar que ninguna fila PQR lo referencia y que la reserva no está en estado recuperable activo.
9. Si la subida tiene resultado ambiguo, no borrar ni subir otro objeto a ciegas. Marcar/conciliar el estado con verificación de Storage.

Sin adjunto, la operación puede pasar directamente de reserva a finalización DB.

## 6. RPC de finalización atómica

Firma conceptual: `pqr_submit_finalize(p_idempotency_key, p_fingerprint, p_submission_fields, p_attachment_metadata)`.

Debe:
- bloquear la fila de reserva;
- comprobar fingerprint y estado;
- comprobar que el objeto Storage existe/metadata verificada cuando hay adjunto (la verificación del objeto se hace antes por Edge Function; la RPC valida la metadata declarada y la ruta esperada);
- insertar `pqr_submissions` con estado inicial `Recibida`;
- insertar evento de historial inicial;
- insertar `applicant_confirmation` y `internal_alert` en Outbox con event_key estable y único;
- guardar submission_id y marcar reserva `completed`;
- devolver el mismo id/radicado en cualquier replay posterior.

Todo lo anterior debe confirmar o revertir como una sola transacción PostgreSQL. La RPC no envía correo.

## 7. Rate limiting

El rate limit existente no debe ejecutarse de manera que un retry de la misma clave consuma una cuota nueva. Se requiere un contrato atómico:
- comprobar/resolver primero la clave idempotente;
- replay de clave existente y fingerprint idéntico no consume otra cuota;
- solo una clave nueva consume cuota;
- la reserva y el consumo de cuota deben ser consistentes ante concurrencia y fallo.

No basta con mover una llamada de Edge Function antes o después de otra. Diseñar una RPC que coordine reserva + cuota o un mecanismo transaccional equivalente. Mantener Turnstile y límites por IP como defensa adicional.

## 8. Respuestas HTTP

| Resultado | HTTP | Comportamiento |
|---|---:|---|
| completed / replay | 200 | Mismo radicado; no repetir side effects |
| claimed y finalización exitosa | 201 | Nuevo radicado |
| in_progress | 202 | Cliente puede consultar/reintentar con misma clave |
| key_conflict | 409 | No crear otro radicado |
| uncertain | 409 o 503 controlado | Conciliación; no repetir side effects |
| validación | 400/422 | Error de campo, sin persistencia parcial |
| rate limit | 429 | Retry-After cuando aplique |
| error previo a reserva | 500/503 | Reintento seguro con misma clave |

No exponer fingerprint, ruta privada ni información interna en respuestas públicas.

## 9. Seguridad y privacidad

- Mantener Turnstile, allowlist de orígenes, CORS mínimo, validación de firma de archivo, tamaño máximo, tipos permitidos y consentimiento.
- Sanitizar nombre del archivo; nunca usarlo como ruta.
- No exponer tabla privada ni RPC a `anon`/ `authenticated`.
- Service role solo en Edge Function.
- No confiar en email, actor, destinatario ni estado enviados por el navegador.
- No registrar base64, descripción completa, email, teléfono, tokens ni claves.
- Aplicar retención/borrado conforme a política de datos; no inventar un plazo en esta implementación.

## 10. Pruebas obligatorias

- 50 POST simultáneos misma clave/mismo payload: un solo radicado y dos eventos Outbox.
- Misma clave y payload alterado: 409; sin segundo radicado.
- Reintento después de timeout previo a respuesta: mismo radicado.
- Caída después de reserva y antes de Storage: operación recuperable.
- Caída después de Storage y antes de finalización: archivo verificado y finalización recuperable.
- Storage rechaza: no crear radicado con adjunto inexistente.
- Fallo DB al crear historial/outbox: rollback del radicado y estado de reserva coherente.
- Retry idéntico no consume cuota adicional; clave nueva sí.
- Usuario sin privilegios no puede invocar RPC ni leer tabla privada.
- Sin adjunto: finalización atómica y replay correcto.
- Dos correos independientes: fallo de uno no modifica el estado del otro.

## 11. Dependencias antes de SQL ejecutable

1. Inspeccionar columnas, constraints, triggers y defaults reales de `pqr_submissions` y `pqr_events`.
2. Definir formato del radicado y generación sin colisiones según implementación existente.
3. Definir política de retención de reservas fallidas/uncertain y limpieza de Storage.
4. Diseñar RPC coordinada de idempotencia + rate limit.
5. Añadir índices, grants, RLS y pruebas de aislamiento.
6. Compilar y ejecutar en PostgreSQL/Supabase aislado; nunca en producción como prueba.

## 12. Estado

Este contrato no modifica el formulario, Edge Function, Storage, base de datos ni secretos. No se ha creado una migración ejecutable ni se declara el flujo implementado.
