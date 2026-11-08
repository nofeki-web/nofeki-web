# NOFEKI PQR — reconciliación exacta de fuentes desplegadas vs GitHub
Fecha: 2026-11-08
Rama: `recovery/pqr-admin-retry-fix-20261108`

## Resultado ejecutivo

Se descargó nuevamente el código activo desde Supabase y se comparó línea por línea con los dos archivos de GitHub. Se guardaron snapshots inmutables en `docs/recovery/deployed-snapshots/`; no se sobrescribió el código de aplicación.

| Función | Supabase | GitHub recovery | Comparación |
|---|---:|---:|---|
| pqr-submit | v6, 209 líneas, 11115 caracteres | 224 líneas, 11602 caracteres | 2 líneas solo desplegadas; 17 solo GitHub |
| pqr-admin | v9, 136 líneas, 9081 caracteres | 159 líneas, 9480 caracteres | 5 líneas solo desplegadas; 28 solo GitHub |

SHA-256 de los bundles Supabase:
- pqr-submit: `ad212775d2484fcfd9fd8c065c23d9d0248b12f5670f163817a0c4d7804d10e8`
- pqr-admin: `b91c45b26500300ed55e4258e653493b76527cdc9a93d5a18b6c925b40dffb1f`

Blob SHA GitHub (branch recovery):
- pqr-submit: `acec264c2843b40096bbed28dac99c56132639af`
- pqr-admin: `a439bbf1bf6803b870de8185598e25a03992f8f4`

## Cambios relevantes identificados

### pqr-submit

1. El flujo desplegado y el de GitHub comparten las defensas principales: validación de origen y payload, Turnstile, rate limit, validación binaria del adjunto, carga a Storage, insert de PQR y envío secuencial de dos emails.
2. El archivo GitHub mejora el manejo del error al persistir `notification_status`: comprueba el error, registra un warning operacional y evita convertir un PQR ya radicado en respuesta HTTP de fallo.
3. El código desplegado ignora el resultado/error del update de notificación. Si falla, la API devuelve éxito sin señal de que el estado de notificación no quedó persistido.
4. El cambio GitHub en ese punto es una mejora válida para portar, pero no corrige el problema estructural: los dos correos se envían dentro del request y no hay outbox/idempotencia.
5. La clave de privacidad desplegada es `privacy_version: "1.3"`; confirmar el texto legal publicado y su versión antes de modificar ese valor.

### pqr-admin

1. Los dos códigos conservan la autenticación manual del bearer con `auth.getUser`, allowlist de un administrador, lectura/listado, y acciones status/note/respond/retry_notification.
2. La rama GitHub agrega trazabilidad por etapa en `retry_notification` y comprueba errores de update e insert. Es una mejora útil para detectar fallos parciales.
3. El código desplegado en `retry_notification` no comprueba ninguno de esos dos errores; puede devolver éxito aun cuando el estado o el evento no se guardaron.
4. El flujo `status` sigue haciendo UPDATE y luego INSERT del evento como dos peticiones separadas, tanto en desplegado como en GitHub.
5. `respond` sigue enviando el correo antes de registrar el evento, por lo que un crash/error de persistencia puede dejar correo enviado sin historial.
6. La rama GitHub añade warning estructurado si el evento de respuesta no se guarda; no vuelve atómico el envío y el historial.
7. Se mantiene el allowlist de correo. No ampliar.
8. La lectura de detalle usa `select("*")`; reducir a columnas explícitas en un cambio posterior, tras verificar contrato de UI.

## Decisión de reconciliación

**No reemplazar ahora los archivos de la rama con los snapshots ni desplegar.** La diferencia no es solo formato; hay cambios de lógica y riesgo de regresión.

La rama de recuperación contiene mejoras que se deben preservar y portar, en especial:
- `pqr-submit`: comprobar persistencia de notificación y exponer `notification_status_persisted`.
- `pqr-admin`: comprobación de errores y logging por etapa en reintento; warning al fallar el historial de respuesta.

Pero ambas fuentes siguen sin ofrecer:
- clave de idempotencia del envío público;
- transacción atómica entre crear caso, evento y notificaciones;
- outbox durable;
- protección contra doble envío al reintentar;
- transición de estado con expected-version/expected-status.

## Fuente canónica temporal

Hasta completar la implementación transaccional:
- Para entender qué está corriendo: usar los snapshots Supabase en `deployed-snapshots`.
- Para revisar mejoras candidatas: usar `supabase/functions/pqr-submit/index.ts` y `pqr-admin/index.ts` de esta rama.
- No asumir que GitHub recovery equivale al despliegue.
- Antes de cualquier deploy, reconciliar explícitamente los dos archivos, correr pruebas y pedir autorización.

## Verificación de cambios de plataforma Supabase

Se revisó el changelog oficial. Cambios relevantes próximos/recientes:
- 2026-10-30: las tablas nuevas en `public` dejan de exponerse automáticamente a Data/GraphQL API en todos los proyectos; el diseño Outbox propone schema privado, por lo que no depende de esa exposición.
- 2026-11-04: CLI v3 es local-first y pide confirmación para cambios hosted. No se usó CLI ni se hizo cambio hosted.
- 2026-11-10: retirada de algunos cifrados TLS 1.2 antiguos en HTTP APIs. No afecta la comparación de fuentes, pero conviene confirmar clientes/entornos antiguos antes de esa fecha.

## Diff de líneas

Los siguientes bloques muestran los hunks de líneas diferentes. `-` significa presente solo en el snapshot desplegado; `+` presente solo en GitHub recovery.

### pqr-submit

#### Hunk 1
```diff
  195/195       notificationError = "No fue posible completar las notificaciones.";
  196/196       console.error("pqr notification error", mailError);
  197/197     }
+ /198     const { error: notificationUpdateError } = await admin.from("pqr_submissions").update({
- 198/     await admin.from("pqr_submissions").update({
  199/199       notification_status: notificationStatus,
  200/200       notification_error: notificationError,
  201/201       notification_sent_at: notificationStatus === "sent" ? new Date().toISOString() : null,
  202/202     }).eq("id", id);
  203/203 
+ /204     if (notificationUpdateError) {
+ /205       // The PQR itself is already stored. Do not tell the applicant that
+ /206       // submission failed; expose the persistence warning for operational review.
+ /207       console.error("PQR created but notification status could not be saved", {
+ /208         reference,
+ /209         code: notificationUpdateError.code,
+ /210       });
+ /211     }
+ /212 
+ /213     return json({
+ /214       ok: true,
+ /215       reference,
+ /216       notification_status: notificationStatus,
+ /217       notification_status_persisted: !notificationUpdateError,
+ /218       message: "Tu solicitud fue radicada correctamente.",
+ /219     }, 201, origin);
- 204/     return json({ ok: true, reference, notification_status: notificationStatus, message: "Tu solicitud fue radicada correctamente." }, 201, origin);
  205/220   } catch (error) {
  206/221     console.error("pqr-submit error", error);
  207/222     return json({ error: "No fue posible radicar tu solicitud. Intenta nuevamente o escríbenos a nofeki07@gmail.com." }, 500, origin);
```

### pqr-admin

#### Hunk 1
```diff
  119/119     }
  120/120 
  121/121     if (action === "retry_notification") {
+ /122       stage = "retry_notification_send";
  122/123       let emailStatus="not_configured";
+ /124       try {
+ /125         emailStatus=await sendMail(row.email,"Confirmación de radicación "+reference,
+ /126           "<p>Hola "+escapeHtml(row.full_name)+",</p><p>Tu solicitud fue recibida por NOFEKI.</p><p>Radicado: <strong>"+reference+"</strong></p><p>Conserva este número para futuras consultas.</p>");
+ /127       } catch(e) {
+ /128         emailStatus="failed";
+ /129         console.error("PQR retry email failed",e);
+ /130       }
+ /131 
+ /132       stage = "retry_notification_update";
+ /133       const {error:updateError}=await db.from("pqr_submissions")
+ /134         .update({
+ /135           notification_status:emailStatus,
+ /136           notification_sent_at:emailStatus==="sent"?new Date().toISOString():null,
+ /137           notification_error:emailStatus==="failed"?"No fue posible enviar el correo":null
+ /138         })
+ /139         .eq("id",row.id);
+ /140       if(updateError) throw updateError;
+ /141 
+ /142       stage = "retry_notification_event";
+ /143       const {error:eventError}=await db.from("pqr_events").insert({
+ /144         submission_id:row.id,
+ /145         actor_email:user.email,
+ /146         event_type:"notification_retry",
+ /147         email_status
+ /148       });
+ /149       if(eventError) throw eventError;
+ /150 
- 123/       try { emailStatus=await sendMail(row.email,"Confirmación de radicación "+reference,
- 124/         "<p>Hola "+escapeHtml(row.full_name)+",</p><p>Tu solicitud fue recibida por NOFEKI.</p><p>Radicado: <strong>"+reference+"</strong></p><p>Conserva este número para futuras consultas.</p>"); }
- 125/       catch(e){emailStatus="failed";console.error("PQR retry email failed",e);}
- 126/       await db.from("pqr_submissions").update({notification_status:emailStatus,notification_sent_at:emailStatus==="sent"?new Date().toISOString():null,notification_error:emailStatus==="failed"?"No fue posible enviar el correo":null}).eq("id",row.id);
- 127/       await db.from("pqr_events").insert({submission_id:row.id,actor_email:user.email,event_type:"notification_retry",email_status});
  128/151       return reply({ok:true,email_status},200,origin);
  129/152     }
  130/153     return reply({ok:false,error:"Acción no reconocida."},400,origin);
```

## Estado
- [x] Recuperar bundles activos.
- [x] Comparación exacta línea por línea.
- [x] Guardar snapshots exactos fuera del código desplegable.
- [x] Identificar mejoras de recovery que se deben conservar.
- [x] Documentar riesgos no resueltos.
- [ ] Unificar código en candidato reconciliado.
- [ ] Pruebas de integración PostgreSQL y proveedor.
- [ ] Aprobación de despliegue.
