# NOFEKI Platforms — contrato de identidad y sesiones unificadas v1

**Estado:** diseño de seguridad; no implementado.  
**Base observada:** auditoría estática del cliente NOFEKI Gastos.  
**Regla:** no cambiar Auth de producción en esta fase.

## 1. Identidad canónica
- `auth.users.id` (UUID) es la identidad canónica de una persona en todo el ecosistema.
- No crear una tabla de usuarios paralela como autoridad de identidad.
- El perfil de Platforms es una proyección mínima asociada 1:1 al UUID.
- El perfil financiero existente de Gastos no se reutiliza como perfil universal.
- La UI nunca elige el `user_id` de una operación protegida; el servidor lo deriva de la sesión validada.

## 2. Compatibilidad actual de Gastos
La revisión estática de `gastos.html` y `vincular-atajo.html` identificó:
- storage key `nofeki-gastos-auth-v1`;
- persistencia de sesión, auto refresh y detección de callback;
- flujo PKCE en cliente principal;
- cliente de recuperación separado `nofeki-gastos-recovery-auth-v1`, con comportamiento distinto;
- la página de vinculación del Atajo comparte la sesión principal.

Contrato de compatibilidad:
1. No renombrar ni reemplazar storage keys en esta fase.
2. No unificar el cliente de recuperación con el principal sin pruebas de enlaces ya enviados.
3. No crear un segundo cliente de Auth persistente para Platforms en el mismo origen.
4. No introducir sincronización manual de tokens entre localStorage, sessionStorage o cookies.
5. No poner tokens en URL, fragmentos, analytics, logs ni mensajes de error.
6. Mantener el acceso directo a Gastos y probarlo independientemente del portal.

## 3. Validación de sesión
- El backend valida firma, issuer, audience, expiración y claims del JWT.
- Para autorización, derivar el usuario de la identidad validada, nunca de body/query.
- No usar `user_metadata` editable como fuente de roles, licencias o permisos.
- Para acciones de alto impacto, evaluar validación de sesión activa/versión de revocación server-side.
- Recordar que un JWT puede seguir vigente hasta expirar aunque el usuario haya sido eliminado o cierre otra sesión; definir controles de revocación de acuerdo con el riesgo.
- Respuestas de autorización fallan cerradas.

## 4. Contexto y autorización
El contexto personal u organizacional es una selección de experiencia, no una credencial.
- Verificar estado de espacio, organización y membresía en cada cambio.
- Resolver entitlement, módulo, rol y permiso server-side.
- No confiar en roles cacheados por el navegador.
- Al cambiar contexto, invalidar datos y permisos de la vista anterior.
- Las APIs de cada producto vuelven a validar acceso.

## 5. Handoff entre dominios
Si los productos están en dominios distintos:
1. Usuario solicita abrir producto.
2. Backend valida sesión, contexto, entitlement y permiso.
3. Backend crea un código aleatorio opaco de un solo uso, hash almacenado, vencimiento breve (objetivo inicial: 60–120 segundos), audiencia y destino allowlisted.
4. Navegador recibe solo el código opaco.
5. Destino canjea el código server-side, valida audiencia, expiración y estado no usado.
6. Canje se consume atómicamente; no se permite replay.
7. Producto establece su sesión conforme a su propia arquitectura segura.

No enviar access token, refresh token, service-role key, contraseña o JWT en query string. El código tampoco debe registrarse en logs; aplicar referrer policy restrictiva y eliminarlo de la barra de dirección después del canje.

## 6. Logout y sesiones
- Logout local debe cerrar la sesión del cliente actual según contrato Supabase Auth.
- Logout de una aplicación no debe aparentar cerrar todas las sesiones si no se ha confirmado revocación global.
- La futura vista “Dispositivos y sesiones” solo se publica cuando la fuente backend sea exacta.
- Revocación de sesión y cierre global necesitan pruebas específicas, incluyendo token ya emitido.
- No introducir expiraciones más cortas ni cambios de timeout como efecto colateral de Platforms.

## 7. Recuperación de contraseña
- Mantener el flujo de recuperación actual y su cliente separado durante v1.
- No cambiar flowType, storage key, redirect URL ni parsing de callbacks sin pruebas en iOS, escritorio y enlaces emitidos previamente.
- No registrar códigos de recuperación ni tokens.
- Mensajes genéricos que no revelen si un correo tiene cuenta.

## 8. Caché y consistencia
- Caché de catálogo puede mejorar UX, pero nunca concede acceso.
- TTL corto y revalidación antes de launch y en APIs protegidas.
- Invalidar al cambiar contexto, membresía, licencia o sesión.
- Ante timeout o estado incierto, no permitir nuevas operaciones protegidas.
- Mantener separación de datos por usuario y organización.

## 9. Threat model mínimo
| Amenaza | Control |
|---|---|
| Manipular user_id | Derivar identidad del JWT validado |
| Elevar rol desde navegador | Roles en backend; ignorar user_metadata |
| Cambiar organization_id | Verificar membresía/estado server-side |
| Replay de handoff | Código de un uso y consumo atómico |
| Token filtrado en URL | No incluir bearer tokens; código opaco y breve |
| Acceso tras revocación | Revalidación server-side y estrategia de sesión |
| Permisos cacheados | Revalidar al cambiar contexto y antes de operaciones |
| Portal caído | Acceso directo de Gastos independiente |
| Error parcial de API | Denegar operaciones nuevas; permitir fallback seguro |

## 10. Pruebas antes de integrar
- Login existente y recarga en escritorio/iOS.
- Refresh token, red intermitente y dos pestañas.
- Logout explícito, externo y global.
- Recuperación con enlaces nuevos y previamente emitidos.
- Sesión del Atajo, vinculación y revocación.
- Context switching entre dos organizaciones con roles distintos.
- Membership/entitlement revocado con token todavía vigente.
- Handoff expirado, audiencia incorrecta y replay.
- XSS/referrer/logging y ausencia de secretos.
- Falla de Platforms sin impacto en Gastos.

## 11. Decisión de implementación
No cambiar Auth, RLS, Edge Functions, tablas, storage keys ni configuración de Vercel ahora. Primero construir y revisar el prototipo aislado; después, plan de pruebas en entorno controlado y aprobación explícita para cada cambio.
