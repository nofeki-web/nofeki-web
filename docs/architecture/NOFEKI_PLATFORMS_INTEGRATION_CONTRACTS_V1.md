# NOFEKI Platforms — contratos de integración y navegación v1

**Estado:** contrato de diseño. No implementado.

## 1. Responsabilidades

| Componente | Responsabilidad |
|---|---|
| Supabase Auth actual | Autenticar persona y emitir sesión |
| Platforms API / Edge Functions nuevas | Resolver contexto, productos, entitlements, permisos y handoff |
| Platforms UI | Mostrar launcher, contexto y acciones permitidas |
| NOFEKI Gastos | Mantener dominio y sesión actual durante convivencia |
| NOFEKI OPS | Validar permisos/licencia en su backend antes de servir operaciones |
| Billing adapter futuro | Verificar eventos de pago y actualizar estado comercial |

## 2. Respuestas API conceptuales

### GET /platform/me
Devuelve perfil mínimo y contexto disponible:
```json
{
  "user": { "id": "uuid", "display_name": null },
  "personal_workspace": { "id": "uuid", "status": "active" },
  "organizations": [
    { "id": "uuid", "name": "Organización", "role": "member", "status": "active" }
  ],
  "default_context": { "type": "personal", "id": "uuid" }
}
```

### POST /platform/context
Entrada:
```json
{ "context_type": "organization", "context_id": "uuid" }
```
La función verifica sesión, existencia, estado y membresía. Devuelve contexto resuelto, no un permiso elegido por el cliente.

### GET /platform/catalog
Entrada: contexto activo validado por servidor.
Devuelve productos y módulos con estado de acceso y acciones UI. No incluye secretos ni reglas internas sensibles.

### POST /platform/products/{product_key}/launch
La función revalida entitlement, rol y permiso. Si el destino es un producto separado, devuelve un código de handoff de un solo uso, breve expiración y audiencia limitada. Nunca devuelve refresh token ni service-role key.

## 3. Reglas del contrato

- Identidad se deriva de JWT validado en servidor; ignorar user_id suministrado por el cliente.
- Contexto no es autoridad: siempre verificar membresía.
- Producto visible no significa API autorizada.
- Launcher y APIs de producto aplican autorización; el backend de OPS no confía en la tarjeta del portal.
- Denegar por defecto ante timeout, respuesta incompleta o error de autorización.
- Handoff idempotente en canje y de un solo uso.
- Registrar correlation_id para soporte sin registrar tokens.
- Respuestas no revelan si un UUID ajeno existe; usar errores genéricos donde corresponda.

## 4. Códigos de error estables

- `AUTH_REQUIRED`
- `CONTEXT_NOT_ALLOWED`
- `MEMBERSHIP_INACTIVE`
- `PRODUCT_NOT_ENTITLED`
- `MODULE_NOT_ENTITLED`
- `PERMISSION_DENIED`
- `LICENSE_EXPIRED`
- `LICENSE_SUSPENDED`
- `HANDOFF_EXPIRED`
- `HANDOFF_ALREADY_USED`
- `PLATFORM_TEMPORARILY_UNAVAILABLE`

## 5. Convivencia sin interrupción

La primera versión del launcher no debe ser requisito para abrir Gastos. El acceso directo existente seguirá disponible. Se incorpora un enlace/entrada al portal solo después de probar sesión, rutas y fallback.

No compartir storage keys de Auth de aplicaciones futuras sin análisis. No alterar el storage key actual de Gastos ni el flujo de recuperación de contraseña como parte de esta fase.

## 6. Pruebas requeridas antes de integrar

- Usuario Gastos existente: launcher abre Gastos con la sesión esperada.
- Usuario con dos organizaciones: permisos no se mezclan al cambiar contexto.
- Miembro revocado: no obtiene handoff nuevo ni opera APIs.
- Entitlement vencido: acceso denegado por backend.
- Código handoff: vence, no puede canjearse dos veces, no funciona en audiencia incorrecta.
- Launcher caído: Gastos directo sigue accesible.
- Respuesta parcial/timeout: UI muestra error recuperable, no acceso abierto.
- XSS/URL/logging: no hay tokens sensibles expuestos.
