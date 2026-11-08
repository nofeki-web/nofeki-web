# NOFEKI — Revisión de autorización del flujo PQR (2026-11-07)

## Función desplegada
- `pqr-admin`, versión 9, ACTIVE; `verify_jwt=false`.
- La función extrae Bearer token y ejecuta `db.auth.getUser(token)`.
- Rechaza token ausente/inválido (401).
- Comprueba email normalizado contra allowlist `ADMIN_EMAILS = ["nofeki07@gmail.com"]`; rechaza otros usuarios (403).
- Estas verificaciones ocurren antes de procesar GET, buscar radicado, emitir URL firmada o ejecutar acciones POST.
- CORS permite solo nofeki.com/www.nofeki.com; CORS no sustituye autenticación.
- Los adjuntos se entregan mediante signed URL de 300 segundos, solo después de validar sesión/admin y encontrar el radicado.

## Evaluación
La secuencia de autenticación/autorización está presente antes del acceso a datos. `verify_jwt=false` no constituye por sí solo vulnerabilidad: la función valida explícitamente el token con Auth. La allowlist de email es el control de autorización de administrador y debe tratarse como configuración crítica.

## Riesgos y mejoras
1. Allowlist hardcodeada: migrar a configuración segura/tabla de roles administrada con controles, auditoría y procedimiento de recuperación, cuando se diseñe el cambio.
2. La consulta GET de detalle devuelve `select("*")`; revisar minimización de datos del panel y evitar exponer columnas que el frontend no necesita.
3. Signed URL de 5 minutos: duración acotada; verificar en pruebas que no se genera para usuarios no autorizados ni para rutas arbitrarias.
4. Acciones status/note/respond/retry_notification requieren pruebas de permisos, consistencia e idempotencia.
5. `retry_notification` desplegada no comprueba errores de UPDATE de `pqr_submissions` ni INSERT de `pqr_events`; puede devolver ok aunque no persista estado/historial. La rama de recuperación incluye controles de error para ambas operaciones, pero aún no está desplegada.
6. `respond` captura el fallo del historial y lo devuelve como advertencia; comprobar que la UI distingue correo enviado de historial persistido.

## Regresión requerida (sin ejecutar en producción)
- Sin Authorization → 401; token inválido/expirado → 401.
- Usuario autenticado no incluido en allowlist → 403.
- Admin autorizado: lista y detalle válidos; referencia inexistente → 404.
- Admin autorizado: signed URL solo para adjunto del radicado; URL expira tras 300 s.
- Status inválido → 400; status válido crea evento y actualiza registro.
- Nota vacía → 400; nota válida registra actor y evento.
- Respuesta menor a 5 caracteres → 400; fallo de proveedor de correo no debe cambiar status; fallo de historial se refleja claramente.
- Reintento de notificación: simular fallo de UPDATE e INSERT por mocks/entorno aislado y confirmar respuesta de error/no éxito falso.
- Usuario no admin nunca debe leer ni mutar PQR aunque conozca el radicado.

## Estado
Análisis del código desplegado v9. No se enviaron correos, no se cargaron adjuntos, no se mutaron radicados ni se desplegó código.