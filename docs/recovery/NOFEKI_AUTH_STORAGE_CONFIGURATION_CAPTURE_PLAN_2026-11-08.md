# NOFEKI — captura de configuración Auth/Storage: plan de cierre

**Fecha:** 2026-11-08  
**Proyecto:** `bxjgodhqseoxrnshqtfr`  
**Estado:** metadatos parciales verificados; configuración Auth completa no disponible mediante las herramientas conectadas en esta sesión.

## 1. Qué se verificó

- Proyecto ACTIVE_HEALTHY, región us-east-1, PostgreSQL 17.11.
- Bucket `pqr-attachments`: privado, 5 MiB, PDF/JPEG/PNG.
- Storage.objects tiene RLS habilitada; no se observaron policies directas.
- Security Advisor reporta leaked password protection desactivada.

## 2. Qué no se pudo consultar desde las herramientas habilitadas

No hay una acción conectada que exponga directamente:
- configuración completa de Auth providers;
- confirmación de correo y ajustes de signup;
- expiración/rotación de sesiones y refresh tokens;
- redirect URLs y Site URL;
- MFA y políticas de contraseña completas;
- configuración SMTP sin revelar credenciales;
- configuración global de Storage y límites de signed URL;
- lifecycle/retención y configuración de archivos.

La documentación de Supabase describe la Management API y el endpoint de configuración Auth `/config/auth`, pero no se dispone aquí de una acción que lea ese endpoint. No se debe simular el resultado ni pedir que se peguen secretos o tokens en el chat.

Referencia: https://api.supabase.com/api/v1

## 3. Captura segura pendiente en Dashboard

Un administrador del proyecto debe exportar o registrar, sin contraseñas, API keys, SMTP credentials ni JWT secrets:

### Authentication
- Site URL y lista completa de redirect URLs.
- Email provider: enabled, confirm email, secure email change, double-confirm change.
- Password policy: longitud mínima y requisitos.
- Leaked password protection: enabled/disabled.
- JWT expiry y refresh-token reuse interval.
- Session timeouts (inactivity / maximum lifetime), si están configurados.
- MFA factors habilitados y restricciones.
- Rate limits relevantes (solo valores, nunca tokens).
- SMTP: configured yes/no, sender name/address y provider; omitir host sensible si se considera confidencial y siempre omitir username/password.
- Hooks y custom access-token settings habilitados/deshabilitados, sin secretos.

### Storage
- Bucket `pqr-attachments`: private, 5 MiB, PDF/JPEG/PNG (ya verificado por catálogo).
- Políticas de `storage.objects` y cualquier configuración global que afecte límites.
- Duración de signed URL configurada por la aplicación (300 segundos observados en pqr-admin).
- Lifecycle/retention y restricciones adicionales si existen.

## 4. Decisiones que no deben aplicarse directamente a producción

- No activar leaked password protection sin prueba de signup, login, cambio y recuperación de contraseña en un entorno controlado.
- No cambiar confirmación de correo, URLs, expiración de JWT o SMTP durante esta captura.
- No modificar políticas de Storage ni ejecutar pruebas de carga/upload en producción.
- No copiar credenciales o secretos al repositorio ni a documentos de auditoría.

## 5. Artefacto de verificación

El script [NOFEKI_RECOVERY_VALIDATION_READ_ONLY.sql](scripts/NOFEKI_RECOVERY_VALIDATION_READ_ONLY.sql) contiene consultas SELECT de catálogo para validar estructura, RLS, policies, rutinas, triggers, índices, constraints, grants, bucket y extensiones después de una restauración aislada. No restaura ni modifica objetos.

## 6. Restauración por objeto: criterio de generación

El DDL ejecutable se generará solo para objetos con definición exacta capturada y revisada. Las rutinas, triggers, event trigger y algunos índices cuya procedencia o definición no esté completamente demostrada permanecerán como bloqueadores; no se crearán stubs ni aproximaciones. El paquete de referencia comentario-only sigue siendo la lista de trabajo y no debe ejecutarse.
