# NOFEKI Platforms — recorrido unificado del usuario v1

**Estado:** diseño funcional; no implementado.  
**Alcance:** identidad, acceso, contextos, productos y cuenta.  
**Compatibilidad:** NOFEKI Gastos conserva su login, sesión y acceso directo actuales.

## 1. Objetivo y promesa
Una persona usa una sola identidad NOFEKI. Desde un portal común puede entrar a su espacio personal, cambiar a una organización donde tenga membresía activa y abrir únicamente productos, módulos y acciones autorizados. Platforms organiza el acceso; no duplica las operaciones de Gastos ni OPS.

## 2. Actores y escenarios
- Usuario personal: tiene Gastos gratuito en su espacio personal.
- Miembro organizacional: pertenece a una o más organizaciones con roles distintos.
- Administrador de organización: administra miembros, cupos y productos dentro de su organización.
- Responsable de facturación: consulta asuntos comerciales, sin privilegios operativos automáticos.
- Administrador interno NOFEKI: gestiona catálogo, soporte y operaciones internas bajo RBAC separado.

## 3. Recorrido principal
1. La persona entra a NOFEKI Platforms.
2. Si no hay sesión, ve opciones de iniciar sesión o crear cuenta.
3. La autenticación delega inicialmente al flujo Supabase Auth ya aprobado.
4. El backend identifica al usuario por el JWT validado y el UUID `auth.users.id`; nunca por un ID enviado libremente por el navegador.
5. Se resuelve el espacio personal y las organizaciones activas.
6. Se establece el contexto actual (personal por defecto si está disponible).
7. El backend devuelve el catálogo efectivo de productos, módulos, licencias y permisos para ese contexto.
8. La persona abre un producto; el backend revalida entitlement y permiso antes de emitir una navegación segura.
9. El producto de destino vuelve a validar autorización en cada operación protegida.

## 4. Registro y primer acceso
- Mantener el alta actual con sus verificaciones, consentimiento y confirmación de correo.
- No crear otro usuario en Platforms ni copiar credenciales.
- La provisión del perfil y del espacio personal debe ser idempotente.
- Gastos gratuito se concede por política del producto; OPS no se habilita por el mero registro.
- Si la provisión está temporalmente caída, mostrar un estado recuperable y no crear duplicados al reintentar.
- No solicitar datos organizacionales a una persona que solo desea usar Gastos.

## 5. Login y recuperación
- Etapa inicial: reutilizar el cliente/flujo de Auth actual de Gastos.
- No cambiar `nofeki-gastos-auth-v1`, PKCE, persistencia, refresh ni el cliente de recuperación en esta fase.
- La recuperación continúa en el flujo actual y no se reimplementa en el portal.
- No abrir una segunda sesión paralela con otro storage key.
- Si se detecta sesión vencida, ofrecer volver a iniciar sesión sin exponer tokens o detalles internos.

## 6. Espacio personal y organizaciones
- Un espacio personal por usuario en v1.
- Cero o más organizaciones con membresía activa.
- El selector muestra el nombre del contexto y el rol correspondiente.
- Cambiar de contexto invalida la vista anterior y solicita al backend un catálogo nuevo.
- La UI no guarda permisos del contexto previo ni permite modificar el contexto mediante un ID arbitrario.
- Organización suspendida o membresía inactiva: contexto no seleccionable.

## 7. Mis productos
### NOFEKI Gastos
- Gratuito, personal.
- Se muestra Disponible cuando el entitlement personal está activo.
- Abrir mantiene la ruta actual y la sesión existente.
- El acceso directo actual permanece funcional aunque Platforms no responda.

### NOFEKI OPS
- Producto licenciado.
- Se muestra según catálogo aprobado y contexto.
- Sin licencia: ver planes/contactar, sin simular acceso.
- Con licencia pero sin cupo asignado: informar al administrador.
- Con licencia y permiso: abrir OPS; backend de OPS revalida.

### Productos futuros
No publicar como disponibles hasta que catálogo, soporte, precio y controles de acceso estén aprobados.

## 8. Invitaciones
1. Administrador invita por correo y asigna rol mínimo permitido.
2. Invitación tiene expiración y estado pendiente.
3. Destinatario autentica con su identidad actual o crea cuenta.
4. Acepta la invitación explícitamente.
5. Backend valida token, expiración, organización, cupo y estado.
6. Membresía se crea de forma idempotente.
7. El contexto organizacional aparece en el selector.
8. Reenvío/revocación queda auditado; nunca se revela si un correo arbitrario ya tiene cuenta.

## 9. Apertura de producto y handoff
- Para Gastos en primera etapa, usar la URL existente y no modificar su Auth.
- Para un producto en otro dominio, el backend emite un código opaco, de un solo uso, audiencia específica y expiración corta.
- El producto canjea el código server-side y establece su propia sesión segura según contrato.
- No incluir access token, refresh token, service-role key ni datos personales en URL, fragmento, telemetría o logs.
- Rechazar replay, expiración, audiencia incorrecta y contexto revocado.

## 10. Cuenta y seguridad
- Mostrar perfil mínimo, correo verificado, idioma y zona horaria si están disponibles.
- Cambio de correo exige verificación.
- Sesiones/dispositivos se muestran solo si el backend puede reportarlos correctamente.
- Cerrar sesión global o revocar dispositivos requiere un mecanismo probado; no simularlo en la UI.
- MFA se plantea como etapa posterior, sin imponerlo a cuentas actuales sin análisis de impacto.
- Consentimientos y privacidad se consultan desde una fuente de verdad; no duplicar ni sobrescribir registros históricos.

## 11. Estados de experiencia
| Estado | Mensaje | Acción |
|---|---|---|
| Cargando contexto | Estamos preparando tu espacio | Esperar / reintentar |
| Sin organizaciones | Todavía no perteneces a una organización | Seguir en Personal |
| Sin entitlement | Este producto requiere acceso | Ver opciones |
| Trial activo | Tu prueba está activa | Abrir |
| Licencia vencida | La licencia necesita renovación | Contactar administrador |
| Membresía revocada | Ya no tienes acceso a este espacio | Cambiar contexto |
| Plataforma no disponible | No pudimos cargar tus productos | Reintentar; Gastos directo sigue disponible |
| Sesión expirada | Vuelve a iniciar sesión | Iniciar sesión |

## 12. Reglas de autorización no negociables
- JWT validado en servidor; identidad derivada de claims confiables.
- No usar `user_metadata` editable por usuario para roles o permisos.
- Membership, license, entitlement, module y permission se verifican server-side.
- Denegar por defecto ante error, timeout o respuesta incompleta.
- El portal no es el perímetro de seguridad: cada API de producto valida su acceso.
- Revocación debe bloquear la siguiente operación protegida; el refresh del launcher es solo presentación.
- Auditoría registra actor, acción, objetivo, resultado y motivo, sin secretos.

## 13. Convivencia y fallback
- Gastos directo no depende del portal para cargar, registrar, editar o eliminar gastos.
- No cambiar rutas, storage key, recuperación, funciones ni RLS existentes en la etapa de diseño.
- La entrada al portal se incorpora de forma gradual y opcional.
- Si Platforms falla, el enlace de Gastos directo permanece visible en la landing y en comunicaciones de soporte.
- La integración futura se activa por feature flag apagado por defecto.

## 14. Criterios de aceptación
1. Un usuario actual entra con la misma identidad, sin registro duplicado.
2. Gastos mantiene su acceso directo si portal/API Platforms no están disponibles.
3. Cambiar de organización refresca el catálogo y no mezcla permisos.
4. Un usuario no puede asignarse un rol o entitlement editando el navegador.
5. OPS no se abre sin licencia, asignación y permiso.
6. Invitación expirada/revocada no crea membresía.
7. Handoff no contiene tokens y no admite replay.
8. Logout y recuperación conservan comportamiento existente hasta pruebas específicas.
9. Toda denegación sensible se aplica en backend.
10. No se cambia producción como parte de este entregable.
