# NOFEKI Platforms — experiencia del portal central v1

**Estado:** especificación UX/funcional; no implementada ni publicada.  
**Rama:** `platforms/architecture-foundation-20261108`

## 1. Propósito

NOFEKI Platforms es la puerta de entrada común del ecosistema. La persona inicia sesión una vez, selecciona su espacio de trabajo y abre los productos a los que tiene acceso. El portal no contiene ni duplica las operaciones de Gastos u OPS: descubre, autoriza y enruta.

## 2. Principios de experiencia

1. Una sola identidad y una sola sesión.
2. El usuario entiende qué productos tiene, cuáles están disponibles y cuáles requieren licencia.
3. No mostrar productos como habilitados por simple existencia de una cuenta.
4. No exponer datos financieros, inventarios ni información operativa dentro del launcher.
5. La organización/contexto activo siempre es visible y cambiable solo entre contextos autorizados.
6. No convertir el portal en un segundo dashboard de cada producto.
7. Diseñar primero mobile responsive, sin sacrificar una experiencia de escritorio empresarial.
8. El estado de acceso debe explicarse con lenguaje claro: Disponible, Solicitar acceso, Requiere licencia, Suspendido o No disponible.

## 3. Estructura de navegación

### Público
- Inicio / presentación del ecosistema
- Productos
- Precios (cuando se definan)
- Seguridad y privacidad
- Iniciar sesión
- Crear cuenta

### Autenticado
- Inicio / Mis productos
- Selector de espacio: Personal / organizaciones
- Productos y módulos
- Mi cuenta
- Organizaciones
- Miembros y roles (según permiso)
- Licencias y plan (según permiso)
- Seguridad: sesiones, recuperación y MFA futuro
- Ayuda / soporte

El launcher no debe mostrar administración de organizaciones o facturación a usuarios que no tengan permisos.

## 4. Pantalla principal: Mis productos

### Cabecera
- Logo NOFEKI Platforms.
- Saludo y nombre de perfil si existe; fallback neutral si no.
- Selector de contexto activo.
- Acceso a cuenta y cerrar sesión.

### Resumen
- Contexto activo: Personal o nombre de organización.
- Estado de cuenta/plataforma.
- Accesos recientes solo si existe telemetría confiable y consentida; no inventar actividad.

### Catálogo
Cada tarjeta de producto presenta:
- Nombre y descripción breve.
- Estado de acceso.
- Módulos incluidos, si aplica.
- Botón contextual: Abrir, Ver módulos, Solicitar acceso o Consultar licencia.
- Indicador de producto en mantenimiento solo si procede de estado operativo real.

Productos iniciales:
- NOFEKI Gastos — Gratuito. Personal. Botón Abrir para cuentas con entitlement.
- NOFEKI OPS — Licenciable. Individual/empresarial. Botón Abrir solo con licencia, módulos y permisos válidos; de lo contrario Ver planes/Contactar.
- Próximos productos — no deben aparecer como productos disponibles hasta que tengan estado de catálogo aprobado; se puede usar una sección “En desarrollo” solo si el equipo decide hacerla pública.

### Estados de tarjeta
| Estado efectivo | Presentación | Acción |
|---|---|---|
| active + permiso | Disponible | Abrir |
| entitlement ausente | Requiere acceso | Ver opciones |
| trial vigente | Prueba activa | Abrir |
| suspended | Acceso suspendido | Ver motivo / soporte |
| expired | Licencia vencida | Renovar / contactar |
| producto retired | No disponible | No mostrar o informar retiro |

La UI consume una respuesta del backend ya resuelta para usuario + contexto. No calcula licencias por su cuenta.

## 5. Selector de contexto

- Por defecto, seleccionar espacio personal si existe y está activo.
- Mostrar organizaciones en las que la membresía esté activa.
- El cambio de contexto requiere revalidación server-side.
- Al cambiar, refrescar productos, roles y límites; no reutilizar permisos del contexto anterior.
- Si la organización está suspendida o la membresía revocada, no permitir entrar a ese contexto.
- Nunca aceptar un organization_id del navegador sin comprobar membresía.

## 6. Flujos de usuario

### A. Usuario actual de NOFEKI Gastos
1. Inicia sesión con su credencial actual.
2. Platforms reconoce el mismo `auth.users.id`.
3. Backend confirma la concesión gratuita de Gastos.
4. Launcher muestra Gastos como disponible.
5. “Abrir” redirige a la ruta/URL existente de Gastos preservando la sesión de forma segura.
6. Gastos continúa operando con su flujo actual durante la primera etapa; si el servicio Platforms falla, no se bloquea Gastos.

### B. Usuario nuevo
1. Crea una cuenta mediante el flujo de Auth aprobado.
2. Confirma correo y acepta los avisos requeridos.
3. Backend provisiona perfil y espacio personal idempotentemente.
4. Backend concede Gastos gratuito conforme a política.
5. El launcher muestra Gastos disponible; OPS requiere licencia.

### C. Usuario invitado a una organización
1. Recibe invitación.
2. Inicia sesión o crea cuenta.
3. Acepta invitación.
4. Backend activa membresía y rol autorizado.
5. Cambia al contexto organizacional.
6. Ve solo productos/módulos licenciados para esa organización y permisos propios.

### D. Compra o asignación de OPS
1. Administrador autorizado consulta plan/cupo.
2. Se registra orden/suscripción por canal confiable.
3. Backend verifica el evento comercial y su idempotencia.
4. Crea/actualiza licencia y entitlements.
5. Asigna cupos a usuarios elegibles.
6. Launcher actualiza el acceso; APIs de OPS validan de nuevo cada operación protegida.

### E. Revocación
1. Administrador autorizado revoca membresía, licencia o entitlement.
2. Backend registra actor, fecha y motivo.
3. La siguiente operación protegida deniega acceso.
4. El launcher actualiza estado al refrescar.
5. Los datos del cliente permanecen intactos.

## 7. Enrutamiento a productos

No acoplar el portal a rutas hardcodeadas dispersas. Mantener un registro de servicios/productos con:
- product_key;
- portal_url validada y allowlisted;
- ambiente (prod/preview/dev);
- estado del servicio;
- estrategia de handoff;
- versión del contrato de integración.

Primera etapa: Gastos puede abrir su URL actual dentro del mismo dominio/flujo, sin migrar la página ni su Auth. No implementar un token de sesión propio ni poner JWT/refresh token en query string, URL, localStorage compartido ni logs.

Para productos en dominios distintos, diseñar handoff con código de un solo uso, corto vencimiento, audiencia específica, PKCE/nonce cuando corresponda y canje server-side. Nunca enviar service-role keys ni tokens de larga duración al launcher.

## 8. Panel de organización

Secciones condicionales:
- Resumen de organización.
- Miembros: invitar, cambiar rol, suspender/revocar.
- Productos: ver productos contratados y módulos activos.
- Licencias: cupos totales, asignados y disponibles.
- Actividad: cambios administrativos y auditoría visible para roles autorizados.
- Facturación: solo cuando proveedor y alcance estén definidos.

El rol billing_admin no obtiene permisos operativos por defecto. Un miembro no puede autoconcederse roles, cupos ni licencias.

## 9. Mi cuenta

- Nombre visible y datos de contacto mínimos.
- Correo de inicio de sesión (no editable desde una pantalla sin flujo de verificación).
- Preferencias de idioma/zona horaria.
- Sesiones/dispositivos y cierre de sesiones (cuando esté soportado).
- Seguridad y recuperación.
- Consentimientos y privacidad con historial conforme a política.

No replicar datos del perfil financiero de Gastos en el perfil global.

## 10. Arquitectura de pantallas propuesta

- `/platforms/` — landing pública.
- `/platforms/login` — autenticación (en primera fase puede delegar al flujo existente).
- `/platforms/app` — launcher Mis productos.
- `/platforms/app/organizations` — organizaciones.
- `/platforms/app/organization/:id` — detalle/contexto.
- `/platforms/app/members` — miembros, protegido.
- `/platforms/app/licenses` — licencias, protegido.
- `/platforms/app/account` — cuenta.

Estas son rutas objetivo, no rutas publicadas. No crear rewrites ni modificar el sitio hasta revisar Vercel y el mecanismo de routing estático.

## 11. Accesibilidad y responsive

- Contraste WCAG AA para texto y controles.
- Navegación completa por teclado y foco visible.
- Etiquetas accesibles y estados no comunicados solo por color.
- Tarjetas de producto en una columna en móvil, dos/tres en escritorio según espacio.
- Selector de contexto usable con lector de pantalla.
- Estados de carga, vacío, error y sesión expirada explícitos.
- No mostrar errores internos, SQL, IDs de proveedor ni stack traces.

## 12. Métricas de producto (no invasivas)

- Login completado/fallido (agregado).
- Producto abierto y resultado del handoff.
- Denegaciones de acceso por causa general.
- Invitaciones aceptadas/expiradas.
- Errores de provisionamiento y sincronización.
- No registrar contraseñas, tokens, datos financieros ni payloads sensibles.

## 13. Límites de v1

Fuera de alcance inicial:
- Billing/pagos en línea.
- SSO empresarial externo.
- MFA obligatorio hasta revisar impacto en usuarios actuales.
- Administración interna de soporte con impersonación.
- Marketplace público.
- Microfrontends.
- Reescritura de Gastos o cambio de framework.

## 14. Criterios de aceptación

- Usuario actual de Gastos entra sin crear nueva cuenta.
- Un solo UUID identifica a la persona en todo el ecosistema.
- Gastos aparece disponible por entitlement; OPS no aparece habilitado sin licencia.
- Contexto personal y organización están claramente diferenciados.
- El cambio de contexto refresca permisos.
- Usuario sin permiso no ve acciones administrativas ni puede ejecutarlas vía API.
- Una revocación bloquea la siguiente operación server-side.
- Caída del launcher no bloquea el acceso directo existente a Gastos.
- Ningún token sensible se transmite por URL.
- No se ha cambiado producción hasta pasar pruebas aisladas y obtener aprobación.
