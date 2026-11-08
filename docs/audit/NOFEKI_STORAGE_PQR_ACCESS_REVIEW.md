# NOFEKI — Revisión de acceso Storage para adjuntos PQR
Fecha: 2026-11-07
Método: lectura del catálogo y del código desplegado de Edge Functions.

## Configuración observada
- Bucket: `pqr-attachments`.
- Privado (`public=false`).
- Límite: 5,242,880 bytes (5 MiB).
- MIME permitidos: `application/pdf`, `image/jpeg`, `image/png`.
- RLS de `storage.objects` habilitado; no se observaron policies en la consulta de catálogo.

## Flujo de aplicación observado
1. `pqr-submit` utiliza cliente administrativo con `SUPABASE_SERVICE_ROLE_KEY` para subir el archivo al bucket privado.
2. Si el flujo de radicación falla después de cargar el archivo, el código intenta eliminar el objeto.
3. `pqr-admin` usa `createSignedUrl(path, 300)` para generar URL temporal de cinco minutos para adjunto.
4. El cliente web no debe recibir ni almacenar la service_role key.

## Evaluación
La ausencia de policies directas evita que el cliente acceda ordinariamente a los objetos mediante Storage API con sus roles públicos/autenticados. El backend privilegiado es el punto crítico: debe validar sesión, allowlist/rol de administrador y que el path corresponda a la solicitud autorizada antes de firmar la URL.

## Pendiente de validación funcional
No se hicieron uploads ni descargas de prueba y no se generaron URLs firmadas reales en esta auditoría. Antes de liberar:
- Probar archivo permitido y rechazo de MIME/extensión/firma no válida.
- Probar rechazo por tamaño superior al límite.
- Probar que un usuario no administrador no puede invocar la firma.
- Probar que un administrador solo obtiene URL para el adjunto asociado a la PQR consultada.
- Confirmar expiración de la URL temporal y comportamiento después de 300 segundos.
- Probar cleanup del archivo si la inserción de PQR falla.
- Confirmar que los errores no revelan paths sensibles ni credenciales.

No crear policies nuevas ni cambiar la privacidad del bucket sin un diseño de autorización y pruebas. No ejecutar cambios en producción como parte de este documento.
