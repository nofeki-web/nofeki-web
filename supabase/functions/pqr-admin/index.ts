import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_EMAILS = ["nofeki07@gmail.com"];
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("PQR_FROM_EMAIL") || "";
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const statuses = ["Recibida","En revisión","En gestión","Respondida","Cerrada"];
const cors = (origin: string | null) => ({ "Access-Control-Allow-Origin": origin === "https://nofeki.com" ? origin : "https://www.nofeki.com", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Vary":"Origin", "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store" });
const reply = (body: unknown, status=200, origin: string | null=null) => new Response(JSON.stringify(body), { status, headers:cors(origin) });
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));

async function sendMail(to:string, subject:string, html:string) {
  if (!RESEND_KEY || !FROM_EMAIL) return "not_configured";
  const r = await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{ Authorization:"Bearer "+RESEND_KEY, "Content-Type":"application/json" },
    body:JSON.stringify({ from:FROM_EMAIL, to:[to], subject, html })
  });
  if (!r.ok) throw new Error("Resend HTTP "+r.status);
  return "sent";
}

Deno.serve(async req => {
  const origin = req.headers.get("origin");
  if (origin && !["https://nofeki.com","https://www.nofeki.com"].includes(origin)) return reply({ok:false,error:"Origen no autorizado."},403,origin);
  if (req.method === "OPTIONS") return new Response("ok", {headers:cors(origin)});
  if (!["GET","POST"].includes(req.method)) return reply({ok:false,error:"Método no permitido."},405,origin);
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i,"");
  if (!token) return reply({ok:false,error:"Inicia sesión."},401,origin);
  const {data:{user},error:userError} = await db.auth.getUser(token);
  if (userError || !user?.email) return reply({ok:false,error:"Sesión inválida."},401,origin);
  if (!ADMIN_EMAILS.includes(user.email.toLowerCase())) return reply({ok:false,error:"No tienes permisos para administrar PQR."},403,origin);

  let stage = "request";
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const ref = url.searchParams.get("reference");
      if (ref) {
        const {data:row,error} = await db.from("pqr_submissions").select("*").eq("reference_code",ref).maybeSingle();
        if (error) throw error;
        if (!row) return reply({ok:false,error:"Radicado no encontrado."},404,origin);
        const {data:events,error:eventError} = await db.from("pqr_events").select("*").eq("submission_id",row.id).order("created_at",{ascending:true});
        if (eventError) throw eventError;
        let attachmentUrl = null;
        if (row.attachment_path) {
          const {data:signed,error:signedError} = await db.storage.from("pqr-attachments").createSignedUrl(row.attachment_path,300);
          if (signedError) throw signedError;
          attachmentUrl = signed.signedUrl;
        }
        return reply({ok:true,submission:row,events:events||[],attachment_url:attachmentUrl},200,origin);
      }
      const status = url.searchParams.get("status");
      const q = (url.searchParams.get("q")||"").trim().slice(0,100);
      let query = db.from("pqr_submissions").select("id,reference_code,request_type,full_name,email,subject,status,notification_status,created_at,updated_at").order("created_at",{ascending:false}).limit(100);
      if (status && statuses.includes(status)) query=query.eq("status",status);
      if (q) query=query.or("reference_code.ilike.%"+q+"%,full_name.ilike.%"+q+"%,email.ilike.%"+q+"%,subject.ilike.%"+q+"%");
      const {data,error} = await query;
      if (error) throw error;
      return reply({ok:true,submissions:data||[]},200,origin);
    }

    const body = await req.json();
    const reference = String(body.reference||"").trim();
    const action = String(body.action||"");
    if (!reference) return reply({ok:false,error:"Falta el radicado."},400,origin);
    const {data:row,error:lookupError} = await db.from("pqr_submissions").select("*").eq("reference_code",reference).maybeSingle();
    if (lookupError) throw lookupError;
    if (!row) return reply({ok:false,error:"Radicado no encontrado."},404);

    if (action === "status") {
      const next = String(body.status||"");
      if (!statuses.includes(next)) return reply({ok:false,error:"Estado no válido."},400,origin);
      const {error} = await db.from("pqr_submissions").update({status:next,updated_at:new Date().toISOString(),...(next==="Respondida"?{responded_at:new Date().toISOString()}:{})}).eq("id",row.id);
      if (error) throw error;
      const {error:eventError} = await db.from("pqr_events").insert({submission_id:row.id,actor_email:user.email,event_type:"status_changed",old_status:row.status,new_status:next,note:String(body.note||"").slice(0,2000)||null});
      if (eventError) throw eventError;
      return reply({ok:true},200,origin);
    }

    if (action === "note") {
      const note=String(body.note||"").trim().slice(0,4000);
      if (!note) return reply({ok:false,error:"Escribe la nota interna."},400,origin);
      const {error}=await db.from("pqr_events").insert({submission_id:row.id,actor_email:user.email,event_type:"internal_note",note});
      if(error) throw error;
      return reply({ok:true},200,origin);
    }

    if (action === "respond") {
      stage = "validate_response";
      const response=String(body.response||"").trim().slice(0,5000);
      if(response.length<5) return reply({ok:false,error:"La respuesta debe tener al menos 5 caracteres."},400,origin);
      let emailStatus="not_configured";
      try {
        stage = "send_email";
        emailStatus=await sendMail(row.email,"Respuesta a tu solicitud "+reference,
          "<p>Hola "+escapeHtml(row.full_name)+",</p><p>Hemos actualizado tu solicitud <strong>"+reference+"</strong>.</p><p>"+escapeHtml(response).replace(/\n/g,"<br>")+"</p><p>Equipo NOFEKI</p>");
      } catch(e) { emailStatus="failed"; console.error("PQR response email failed",e); }
      stage = "update_submission";
      // Sending an email must not override the status selected by the administrator.
      // The status is exclusively controlled by the explicit "status" action.
      const nextStatus=row.status;
      const {error:updateError}=await db.from("pqr_submissions").update({responded_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",row.id);
      if(updateError) throw updateError;
      stage = "write_response_event";
      let historySaved = true;
      let historyWarning = null;
      const {error:eventError}=await db.from("pqr_events").insert({submission_id:row.id,actor_email:user.email||"admin",event_type:"response_sent",old_status:row.status,new_status:nextStatus,response,email_status:emailStatus});
      if(eventError) {
        historySaved = false;
        historyWarning = eventError.message;
        console.error("PQR response sent but history insert failed", {code:eventError.code,message:eventError.message});
      }
      return reply({ok:true,email_status:emailStatus,history_saved:historySaved,history_warning:historyWarning,message:emailStatus==="sent"?(historySaved?"Respuesta enviada y registrada correctamente.":"Correo enviado; el historial requiere revisión."):"Respuesta guardada; el correo requiere configuración o reintento."},200,origin);
    }

    if (action === "retry_notification") {
      stage = "retry_notification_send";
      let emailStatus="not_configured";
      try {
        emailStatus=await sendMail(row.email,"Confirmación de radicación "+reference,
          "<p>Hola "+escapeHtml(row.full_name)+",</p><p>Tu solicitud fue recibida por NOFEKI.</p><p>Radicado: <strong>"+reference+"</strong></p><p>Conserva este número para futuras consultas.</p>");
      } catch(e) {
        emailStatus="failed";
        console.error("PQR retry email failed",e);
      }

      stage = "retry_notification_update";
      const {error:updateError}=await db.from("pqr_submissions")
        .update({
          notification_status:emailStatus,
          notification_sent_at:emailStatus==="sent"?new Date().toISOString():null,
          notification_error:emailStatus==="failed"?"No fue posible enviar el correo":null
        })
        .eq("id",row.id);
      if(updateError) throw updateError;

      stage = "retry_notification_event";
      const {error:eventError}=await db.from("pqr_events").insert({
        submission_id:row.id,
        actor_email:user.email,
        event_type:"notification_retry",
        email_status
      });
      if(eventError) throw eventError;

      return reply({ok:true,email_status},200,origin);
    }
    return reply({ok:false,error:"Acción no reconocida."},400,origin);
  } catch(e) {
    console.error("pqr-admin error", {stage, message:e instanceof Error ? e.message : String(e)});
    return reply({ok:false,error:"No fue posible procesar la solicitud."},500,origin);
  }
});
