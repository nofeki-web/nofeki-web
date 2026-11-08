# NOFEKI — Matriz de regresión integral v1

**Tipo:** plan de pruebas; no ejecutado en producción.  
**Entorno requerido:** proyecto Supabase aislado, cuentas sintéticas y correos/adjuntos de prueba.

## A. Autenticación y separación de usuarios
- Usuario A inicia sesión, usuario B inicia sesión; cada uno solo ve sus gastos, ingresos, perfil, categorías y presupuestos.
- anon no puede leer/escribir tablas personales.
- usuario autenticado no puede alterar user_id de una fila a otro usuario.
- recuperación de contraseña y expiración de sesión.
- PQR admin: no token 401; token inválido 401; usuario no allowlisted 403; admin autorizado 200.

## B. Gastos web
- Crear gasto válido; confirmar una fila y respuesta con ID.
- Importe cero/negativo, descripción vacía, categoría inválida: rechazo UI/backend según contrato.
- Doble clic/reintento con misma idempotency_key: no duplicar.
- Misma clave con distinto usuario: no colisión entre usuarios.
- Editar/eliminar gasto propio; no poder editar/eliminar el de otro usuario.
- Paginación de más de 500 registros y filtros de fecha.
- Cargar datos vacíos y errores de red sin bloquear el dashboard.

## C. Presupuesto e ingresos
- Guardar modalidad income con asignación + ahorro <= ingreso.
- Guardar modalidad manual sin income_amount y ahorro 0.
- Guardar mes y editar el mismo mes sin duplicar presupuesto.
- Reemplazo de categorías debe ser atómico: fallo intermedio no deja presupuesto parcial.
- No permitir categorías de presupuesto asociadas a presupuesto de otro usuario.
- Copiar presupuesto del mes anterior y verificar ID/periodo/categorías.
- Ingreso: alta, edición, eliminación, orden por fecha y límites de campos.
- Indicador ejecutado vs asignado: cálculo del mes seleccionado, categorías sin límite y exceso >100%.

## D. Atajo iOS
- Crear código con sesión válida; código expira a 5 minutos y solo se canjea una vez.
- Código inválido, vencido o reutilizado: rechazo.
- Usuario con autorización activa no puede crear segunda vinculación.
- Canje exitoso genera token aleatorio y solo se almacena hash.
- Registrar gasto: token válido crea una fila; revocado/expirado/alterado rechaza.
- Repetición con misma idempotency_key no duplica.
- Fallo de RPC tras claim consume código; UI debe indicar que se genere uno nuevo.
- Revocar autorización y comprobar que el atajo deja de registrar inmediatamente.
- Categorías del atajo coinciden con categorías permitidas para ese usuario.

## E. PQR público
- Sin consentimiento, Turnstile ausente/inválido/hostname distinto: rechazo.
- Honeypot: respuesta neutra sin crear registro.
- Límite 5 por ventana; concurrencia alrededor del límite.
- Adjuntos PDF/JPEG/PNG válidos hasta 5 MB; MIME declarado que no coincide con firma, archivo corrupto o >5 MB: rechazo.
- Fallo de insert tras upload: objeto Storage eliminado.
- Fallo de email no borra el radicado; estado de notificación refleja resultado.
- Validar cabeceras IP confiables detrás del proxy, sin confiar en X-Forwarded-For del cliente.

## F. PQR administración
- Listar/buscar/filtrar/detalle solo con admin.
- Adjunto firmado 300 s; referencia no existente 404; usuario no admin nunca recibe signed URL.
- Cambio de estado crea evento coherente.
- Nota vacía rechazada; nota válida registra actor.
- Respuesta enviada y evento de historial; fallo del proveedor no cambia status.
- Reintento de notificación: simular error UPDATE e INSERT y comprobar no devolver éxito falso.
- Doble reintento: comprobar comportamiento idempotente o documentar duplicidad de correo.
- Fallo de historial tras correo enviado: mostrar advertencia explícita y ruta de conciliación.

## G. Seguridad y operación
- RLS por tabla y rol; grants anon/authenticated/service_role.
- SECURITY DEFINER: owner, search_path fijo, ACL y auth checks.
- Storage privado y políticas mínimas.
- Edge Function secretos no aparecen en frontend, logs ni repositorio.
- CORS no se trata como autenticación.
- Confirmar versiones de Edge Functions, verify_jwt y hashes de código.
- Backup/restore en entorno aislado; comparar conteos, constraints, índices, funciones, triggers, ACL, policies y Storage.
- Smoke test UI en móvil/desktop y navegador iOS.

## Evidencia por caso
Registrar: ID, fecha, commit/ref, versión función, entorno, usuario/rol, datos sintéticos, pasos, resultado esperado/real, logs sin PII, evidencia y responsable.

## Criterio de aprobación
100% de pruebas críticas A, D, E y F aprobadas; cero acceso cruzado entre usuarios; cero secretos expuestos; restauración aislada repetible. No aprobar con pruebas críticas omitidas.