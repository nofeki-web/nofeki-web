# NOFEKI Platforms — UX del portal unificado v1

**Estado:** especificación de experiencia; no implementada.  
**Referencia visual:** prototipo estático no productivo en `docs/architecture/prototypes/no feki-platforms-user-portal-mockup.html` (sin espacios en el nombre real: `nofeki-platforms-user-portal-mockup.html`).

## 1. Dirección visual
- Estética premium, sobria y tecnológica; fondo azul noche, superficies claras, acento naranja NOFEKI y azul frío secundario.
- Tipografía sans-serif legible, jerarquía clara, espacios amplios y componentes consistentes.
- Evitar apariencia de ERP genérico: el portal debe sentirse como un centro de productos, no como otro sistema transaccional.
- Mobile-first: navegación compacta y tarjetas apiladas; escritorio con sidebar y grilla de productos.

## 2. Shell autenticado
- Sidebar: Inicio, Mis productos, Organizaciones, Mi cuenta, Ayuda.
- Elementos de administración (Miembros, Licencias, Facturación) solo si el backend entrega permisos.
- Header: marca, contexto activo, estado de conexión y menú de cuenta.
- Contenido principal: título, contexto, resumen breve y tarjetas.
- El contexto activo siempre visible; cambiarlo refresca datos y permisos.

## 3. Pantallas
### Landing pública
Propuesta de valor del ecosistema, productos aprobados, seguridad/privacidad y CTA de acceso. No mostrar precios hasta aprobación comercial pública.

### Login / registro
Delegar al flujo de Auth actual en primera etapa. Mostrar errores humanos, no códigos internos. No duplicar formularios ni clientes de Auth.

### Mis productos
Tarjetas con nombre, propósito, tipo de licencia, estado efectivo y acción. Gastos gratuito y OPS licenciado. No presentar un producto como Disponible solo porque el usuario tiene cuenta.

### Selector de contexto
Popover accesible con Personal y organizaciones activas; cada organización muestra nombre y rol. Contextos suspendidos se informan pero no se pueden activar.

### Organizaciones
Lista de organizaciones, membresía, rol y estado. Acciones administrativas solo para quien tenga permiso.

### Mi cuenta
Perfil mínimo, seguridad, sesiones cuando sea compatible, preferencias y privacidad.

### Ayuda
Preguntas frecuentes, soporte y estado de servicio si existe una fuente confiable.

## 4. Componentes y copy
- ProductCard: nombre, descripción, etiqueta de acceso, módulos relevantes, CTA.
- ContextSwitcher: contexto activo, tipo y rol.
- AccessState: Disponible, Prueba activa, Requiere acceso, Suspendido, Vencido.
- EmptyState: explicación y una acción siguiente.
- ErrorState: explicación breve, reintento y alternativa segura.
- SessionNotice: sesión expirada o reautenticación requerida.
- AdminAction: siempre confirmación, motivo para operaciones críticas y resultado.

Copy recomendado:
- “Tu espacio de trabajo”
- “Mis productos”
- “Estás en tu espacio personal”
- “Cambiar espacio”
- “Disponible en este espacio”
- “Este producto requiere una licencia”
- “No tienes permisos para esta acción”
- “NOFEKI Gastos sigue disponible desde su acceso directo”

## 5. Estados de pantalla
- Loading: skeleton sin información ficticia.
- Empty: sin organizaciones / sin productos adicionales.
- Partial failure: mantener elementos confirmados y señalar qué no cargó; no inventar estados.
- Platform unavailable: reintentar y fallback a Gastos directo.
- Session expired: solicitar login sin conservar datos sensibles en URL.
- Access denied: no revelar existencia de recursos ajenos.

## 6. Responsive y accesibilidad
- Menú lateral colapsable en móvil.
- Tarjetas en una columna móvil, dos en tablet, hasta tres en escritorio.
- Foco visible, orden lógico de teclado, labels accesibles, contraste WCAG AA.
- No depender exclusivamente del color para expresar estados.
- Área táctil cómoda y controles accesibles con lector de pantalla.
- Tablas administrativas con alternativa móvil en tarjetas.

## 7. No-go UX
- No mostrar controles deshabilitados sin explicar por qué.
- No mostrar permisos técnicos, UUID, token, detalles de backend o SQL.
- No mezclar Gastos personal con datos de una organización.
- No presentar saldos, gastos o inventarios dentro del launcher.
- No mostrar Facturación a usuarios sin permiso.
- No crear falsa actividad reciente si no existe telemetría confiable.

## 8. Criterios de aceptación
La UI debe dejar claro quién inició sesión, qué contexto está activo, qué productos están disponibles, por qué otro producto requiere acceso y cómo regresar a Gastos. Ninguna acción visual debe implicar que la autorización se ha concedido sin confirmación del backend.
