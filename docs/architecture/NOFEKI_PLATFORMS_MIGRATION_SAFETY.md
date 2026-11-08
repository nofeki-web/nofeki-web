# NOFEKI Platforms — plan de migración segura

**Objetivo:** incorporar NOFEKI Gastos al ecosistema sin interrumpir el servicio existente.

## Prohibiciones durante la etapa de diseño

- No ejecutar DDL en el proyecto Supabase de producción.
- No modificar Auth settings, proveedores, plantillas ni políticas de sesión.
- No renombrar/eliminar tablas, columnas, funciones, triggers o buckets de Gastos.
- No reemplazar endpoints existentes ni cambiar el contrato del Atajo.
- No modificar variables de entorno ni configuración de Vercel.
- No crear branches/proyectos Supabase con costo sin cotización y autorización explícita.
- No integrar un PR que pueda disparar despliegues automáticos sin revisar workflows.

## Línea base que se debe preservar

- UUID de usuarios de Supabase Auth.
- Login, logout, recuperación y confirmación de correo.
- Sesiones y persistencia de sesión del frontend.
- Gastos y claves de idempotencia.
- Categorías y métodos de pago.
- Presupuestos, categorías de presupuesto e ingresos.
- Vinculación del Atajo, códigos, hashes, expiración, token, revocación.
- Funciones Edge que atienden el Atajo.
- PQR y administración PQR.

## Secuencia segura

### 0. Baseline y respaldos
- Capturar HEAD de GitHub y lista de migraciones remotas.
- Exportar esquema y definiciones relevantes de funciones.
- Confirmar respaldo disponible y procedimiento real de restauración.
- Inventariar Auth, RLS, grants, triggers y Edge Functions.
- Identificar workflows de Vercel/GitHub Actions que despliegan automáticamente.

### 1. Diseño sin cambios de producción
- Revisar este documento y la matriz de acceso.
- Confirmar nombres, relaciones, estados, reglas de borrado y retención.
- Mantener cualquier DDL como borrador fuera de `supabase/migrations`.

### 2. Entorno de validación
- Preferencia: entorno local cuando el usuario tenga equipo personal.
- Alternativa: proyecto/branch Supabase aislado solo después de conocer costo y obtener autorización.
- No usar producción como entorno de prueba.

### 3. Primera migración aditiva
- Crear el esquema privado `platform` y sus tablas nuevas.
- No cambiar las tablas de Gastos.
- No exponer el esquema a Data API sin una decisión específica.
- RLS y grants mínimos.
- Semillas de catálogo separadas de datos de usuario.
- Ejecutar pruebas negativas y advisors.

### 4. Migración lógica de usuarios
- Mapear usuarios existentes por el mismo `auth.users.id`.
- Crear perfiles de forma idempotente.
- Otorgar entitlement gratuito de Gastos a cuentas existentes, sin duplicar concesiones.
- No copiar contraseñas, sesiones, gastos ni tokens del Atajo.
- No escribir claims de autorización en user_metadata.
- Verificar conteos y muestras antes/después en ambiente de prueba.

### 5. Integración opt-in
- Feature flag inicialmente desactivado.
- Añadir lectura de Platforms en un punto controlado, con fallback seguro.
- Activar solo para usuarios internos/de prueba.
- Medir errores y comprobar todos los flujos de Gastos.
- Ampliar gradualmente después de aprobación.

### 6. Rollback
- Apagar feature flag y volver al flujo de Gastos anterior.
- Conservar tablas nuevas y datos de Platforms para análisis; no borrar a ciegas.
- No revertir migraciones con DROP como mecanismo de rollback.
- La reversión de datos se planifica por operación y con respaldo.

## Gate de producción

No se autoriza despliegue hasta tener:
- entorno de prueba independiente;
- respaldo verificado y restauración practicada;
- migraciones revisadas;
- pruebas de Auth y sesión;
- pruebas del Atajo completas;
- pruebas de Gastos, Presupuesto e Ingresos;
- pruebas de aislamiento multi-tenant y RLS;
- revisión de workflows y riesgo de despliegue;
- plan de rollback;
- aprobación explícita del usuario.
