# NOFEKI Platforms — revisión de superficie de despliegue

**Fecha de revisión:** 2026-11-08  
**Rama de referencia:** `platforms/architecture-foundation-20261108`  
**Alcance:** lectura de estructura GitHub; no se modificó configuración de hosting.

## Hallazgos

1. En la raíz de `main` se observan páginas HTML estáticas, `vercel.json`, `supabase/` y documentación.
2. La consulta de `.github/workflows` en `main` devolvió HTTP 404; no se encontró un directorio de workflows de GitHub Actions en esa ruta.
3. La ausencia de workflows versionados no demuestra que no exista despliegue automático: Vercel puede estar conectado directamente al repositorio mediante integración externa.
4. No se inspeccionaron ni modificaron settings privados de Vercel, Production Branch, Ignored Build Step, Deploy Hooks, variables ni dominios.
5. Por tanto, cualquier PR o merge podría activar un despliegue si la integración externa está habilitada. Esta incertidumbre se trata como riesgo activo.

## Controles adoptados

- No se abrió Pull Request.
- No se hizo merge.
- No se modificó `vercel.json`.
- No se cambió la rama de producción ni configuración de Vercel.
- La rama Platforms contiene únicamente documentación y un borrador SQL no ejecutable.
- La validación de despliegue deberá hacerse desde el panel de Vercel con acceso autorizado, antes de abrir PR.

## Gate previo a PR

Confirmar en Vercel:
- repositorio conectado y Production Branch;
- comportamiento de Preview Deployments;
- si cualquier push/PR inicia build;
- comandos de build y output directory;
- dominios asignados a producción y previews;
- variables y scopes, sin exponer sus valores;
- Deploy Hooks y protecciones de despliegue.

No se necesita modificar nada para completar esta revisión; basta con documentar la configuración real. No se deben compartir secretos ni valores de variables.
