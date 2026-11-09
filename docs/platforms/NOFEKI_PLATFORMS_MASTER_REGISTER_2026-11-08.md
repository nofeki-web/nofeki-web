# NOFEKI Platforms — Registro maestro del ecosistema, migración y modelo comercial

**Fecha de corte:** 8 de noviembre de 2026  
**Rama de documentación:** `platforms/architecture-foundation-20261108`  
**Estado:** documento maestro de continuidad; diseño y preparación, no migración ejecutada.

## 1. Propósito

Consolidar en un solo lugar el alcance de NOFEKI como ecosistema de productos, la arquitectura de identidad y acceso, el modelo comercial, el estado de los trabajos, los riesgos y la ruta de migración. Este registro separa decisiones confirmadas de propuestas pendientes para evitar convertir recomendaciones anteriores en compromisos comerciales o técnicos no aprobados.

## 2. Visión del ecosistema

NOFEKI será el portal y la identidad común desde los que una persona u organización accede a los productos que tenga habilitados. La experiencia objetivo contempla:
- `nofeki.com` como portal principal.
- Una cuenta NOFEKI basada en la identidad existente de Supabase Auth.
- Perfil, organización, membresías, roles y derechos de acceso.
- Catálogo de productos y asignaciones/licencias.
- Aplicaciones independientes integradas al mismo modelo de acceso.

Productos identificados:
- **NOFEKI Gastos:** producto personal; se conserva la base de usuarios e identificadores actuales y la integración del Atajo de iPhone. La modalidad gratuita es la orientación comercial previamente discutida; no debe confundirse con una política de planes ya implementada.
- **NOFEKI OPS:** producto de operaciones/inventarios con orientación empresarial y modelo de suscripción propuesto.
- Otros productos futuros podrán incorporarse al catálogo sin duplicar el sistema de identidad.

## 3. Decisiones y restricciones confirmadas

1. La migración a NOFEKI Platforms debe reutilizar la identidad actual de NOFEKI Gastos y preservar los UUID de usuarios existentes.
2. El acceso a productos se gobernará por perfil, rol y licencia/entitlement.
3. La migración no debe interrumpir ni romper el sistema productivo actual.
4. La arquitectura se trabaja primero en la rama `platforms/architecture-foundation-20261108`, en modo documentación/preparación.
5. No se ha autorizado aplicar cambios a Supabase productivo, Auth, Storage, Vercel, secretos, funciones desplegadas, ni fusionar/desplegar la rama.
6. Debe existir un entorno aislado, respaldo restaurable, pruebas y plan de reversión antes de migrar.
7. La rama Platforms se reportó en el trabajo previo con 31 commits por delante de `main`, 0 por detrás y 29 documentos; confirmar de nuevo antes de cualquier integración.

## 4. Arquitectura funcional objetivo

### 4.1 Identidad y acceso
- Supabase Auth sigue siendo el proveedor de identidad inicial.
- Perfil de plataforma vinculado a `auth.users.id`, sin crear identidades paralelas.
- Organizaciones, membresías y roles para separar usuarios individuales de equipos/empresas.
- Catálogo de productos y entitlements para resolver si un usuario puede abrir un producto y con qué capacidades.
- Autorización en servidor/base de datos; nunca confiar en flags enviados por el navegador ni en `user_metadata` editable para decisiones de permisos.
- RLS y grants mínimos en tablas expuestas; service-role exclusivamente en backend.
- Revisar coexistencia de sesiones, redirect URLs, PKCE, recuperación de contraseña y logout entre aplicaciones antes de cambiar el flujo.

### 4.2 Portal
- Inicio de sesión central.
- Perfil y organización.
- Catálogo “Mis productos”.
- Estado de acceso/licencia y navegación al producto.
- Gestión de miembros y roles cuando aplique.
- Área comercial y de facturación como capa separada del núcleo de identidad.

### 4.3 Integración de aplicaciones
Primera integración: NOFEKI Gastos, preservando UUID, datos, sesiones compatibles y el Atajo de iPhone.  
Segunda integración: NOFEKI OPS, una vez estable el núcleo de identidad, organizaciones y permisos.  
No mover tablas de negocio de cada producto al núcleo central salvo necesidad demostrada.

## 5. Modelo comercial de NOFEKI OPS

### 5.1 Precios discutidos

| Plan | Precio mensual propuesto |
|---|---:|
| Essential | COP $299.000 |
| Growth | COP $599.000 |
| Scale | COP $1.199.000 |

Estos valores se registraron como propuesta comercial aceptada para continuar el diseño; no son tarifas publicadas ni están conectadas a checkout.

### 5.2 Prueba y periodicidad
- Prueba gratuita de 7 días: decisión previa del usuario.
- Sin exigir tarjeta de crédito para iniciar la prueba: decisión previa.
- Sin conversión automática al finalizar la prueba: decisión previa.
- Facturación mensual y anual: decisión previa.
- Descuento anual del 10%: propuesta todavía pendiente de validación financiera y aprobación final.

### 5.3 Pasarela y cobros
- Wompi y Mercado Pago quedaron como alternativas a evaluar.
- No se seleccionó pasarela.
- No existe checkout productivo, suscripción recurrente implementada ni conciliación automatizada confirmada.
- Antes de seleccionar: comparar tarifas efectivas, recurrencia/tokenización, webhooks, reembolsos, contracargos, conciliación, soporte local, tiempos de dispersión y requisitos de vinculación.

### 5.4 Administración financiera
Módulo interno propuesto para:
- MRR y ARR.
- Cobros recibidos y caja.
- Cartera y pagos fallidos.
- Suscripciones activas, en prueba, vencidas y canceladas.
- Reembolsos, ajustes y conciliación.
- Indicadores por producto, plan y periodo.

No confundir ingresos contratados (MRR/ARR) con dinero efectivamente recaudado ni con tratamiento contable/tributario.

### 5.5 DIAN y operación comercial
Pendiente definir el flujo de facturación electrónica, responsabilidades tributarias, tratamiento de IVA según servicio/condición aplicable, documentos soporte y proceso de cartera. Requiere validación contable/tributaria para Colombia antes de vender formalmente.

## 6. Modelo de datos conceptual pendiente de especificación final

Entidades esperadas, no equivalentes todavía a migraciones aprobadas:
- `platform_profiles`: perfil de plataforma vinculado al UUID de Auth.
- `organizations`: empresas/equipos.
- `organization_members`: pertenencia y rol.
- `products`: catálogo de aplicaciones.
- `plans`: planes comerciales y límites.
- `subscriptions`: ciclo de vida comercial.
- `entitlements`: derechos efectivos de acceso/capacidades.
- `billing_customers` / `payment_customers`: referencias seguras del proveedor.
- `billing_events`: registro de webhooks y conciliación.
- `audit_events`: cambios sensibles de permisos y suscripciones.

El esquema debe evitar duplicar información de Auth y debe separar identidad, autorización, suscripción y estado de pago. Los webhooks deben verificarse en servidor, ser idempotentes y no conceder acceso basándose únicamente en el retorno del navegador.

## 7. Ruta de migración

### Fase A — Inventario y reconciliación
- Inventariar tablas, funciones, triggers, políticas, grants, Auth settings, Storage, secrets referenciados, redirect URLs y despliegues.
- Conciliar las 16 migraciones remotas mencionadas en el trabajo previo con los 3 archivos SQL de `main`; no asumir que el historial Git representa el esquema productivo.
- Confirmar el estado actual de Gastos, Atajo, sesiones y flujos de recuperación.

### Fase B — Entorno local aislado
- Instalar Docker Desktop, Git, Node.js, Deno, editor y Supabase CLI en el PC personal.
- Verificar versiones usando documentación/ayuda oficial vigente.
- Clonar repositorio y checkout de rama Platforms.
- Arrancar Supabase local; cargar esquema y datos sintéticos, nunca copiar PII productiva sin proceso aprobado.
- Crear pruebas repetibles y variables locales de prueba.

### Fase C — Núcleo Platforms
- Definir migraciones pequeñas, ordenadas y reversibles.
- Implementar perfiles, organizaciones, membresías, catálogo y entitlements.
- Definir políticas RLS y pruebas negativas de acceso cruzado.
- Validar que identidad y sesión existentes siguen funcionando.

### Fase D — Migración piloto de Gastos
- Vincular usuarios existentes por UUID, sin duplicar Auth users.
- Migrar/asignar permisos de producto.
- Probar login, logout, recuperación de contraseña, registro/consulta/eliminación de gastos y Atajo.
- Ejecutar pruebas con usuarios sintéticos y piloto controlado antes de ampliar.

### Fase E — Integración de OPS y comercial
- Integrar OPS al mismo sistema de identidad.
- Definir organizaciones, cupos, roles y límites por plan.
- Seleccionar pasarela después de evaluación.
- Implementar checkout, webhooks idempotentes, suscripciones, pruebas, renovación, cancelación, reembolso y conciliación.
- Conectar entitlements a pagos confirmados desde servidor.

### Fase F — Producción y reversión
- Backups verificados y ensayo de restauración.
- Comparación de esquema y conteos antes/después.
- Despliegue gradual con criterios de aceptación.
- Monitoreo de login, errores, accesos denegados, webhooks y pagos.
- Plan de rollback que preserve UUID, datos y sesiones cuando sea técnicamente viable.

## 8. Pruebas de aceptación mínimas

1. Usuario actual de Gastos entra con la misma cuenta y conserva su UUID.
2. No se crean cuentas duplicadas al registrarse/iniciar sesión desde el portal.
3. Un usuario sin entitlement no puede abrir datos ni APIs del producto por manipulación de URL.
4. Un miembro de una organización no puede consultar datos de otra organización.
5. Un administrador puede asignar/revocar roles sin depender de claims editables por el usuario.
6. Recuperación de contraseña, confirmación de correo, PKCE, refresh y logout funcionan en todos los dominios.
7. El Atajo de iPhone sigue registrando gastos y la revocación sigue bloqueando el dispositivo vinculado.
8. La prueba gratuita termina sin cobro automático ni conversión no consentida.
9. Los webhooks duplicados o fuera de orden no duplican cargos ni licencias.
10. Un pago fallido o reembolso actualiza entitlements conforme a política aprobada.
11. Existe un ensayo de restauración y rollback documentado.

## 9. Estado actual y límites

**Preparado/documentado:** visión de plataforma, restricciones de continuidad, reutilización de Auth/UUID, modelo de acceso por perfiles/roles/licencias, propuesta de planes OPS, prueba gratuita, periodicidad, alternativas de pasarela y hoja de ruta.

**No implementado o no validado:** esquema Platforms aplicado, SSO/portal central operativo, migración de usuarios, RLS de plataforma probada, checkout, pasarela, suscripciones, webhooks, facturación DIAN, panel financiero y producción.

El PC con Docker habilitará la fase de pruebas locales y migración controlada; no es requisito para seguir documentando y refinando el diseño.

## 10. Próximos entregables

1. Inventario detallado de la rama Platforms y clasificación de decisiones vs propuestas.
2. Contrato de identidad, organizaciones, roles y entitlements.
3. Matriz de compatibilidad de Auth y sesiones entre dominios/productos.
4. Comparativo Wompi vs Mercado Pago con costos y capacidades vigentes.
5. Especificación funcional de planes Essential/Growth/Scale y límites por plan.
6. Diseño del módulo financiero y conciliación.
7. Plan de migración de Gastos por etapas y pruebas de rollback.

## 11. Registro de decisiones comerciales

| Tema | Estado |
|---|---|
| Precios Essential/Growth/Scale | Propuesta registrada para continuar diseño |
| Prueba 7 días | Decidida |
| No pedir tarjeta al iniciar prueba | Decidido |
| No conversión automática al terminar prueba | Decidido |
| Mensual y anual | Decidido |
| Descuento anual 10% | Propuesta, no validada |
| Wompi vs Mercado Pago | Sin decisión |
| Facturación DIAN | Pendiente de definición/validación |
| Monetización de Gastos | Mantener modalidad gratuita como orientación actual; no implementar paywall sin nueva decisión |
| OPS como SaaS empresarial | Dirección comercial definida; especificación de límites pendiente |

---
**Regla de gobierno:** todo cambio productivo requiere aprobación explícita, entorno aislado validado, revisión de seguridad, respaldo restaurable y plan de reversión. Este documento no autoriza por sí mismo migraciones, despliegues ni cobros.
