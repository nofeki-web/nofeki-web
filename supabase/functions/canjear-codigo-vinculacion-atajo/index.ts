import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const allowedOrigins=new Set(["https://nofeki.com","https://www.nofeki.com"]);
function cors(req:Request){const origin=req.headers.get("Origin")??"";return {"Access-Control-Allow-Origin":allowedOrigins.has(origin)?origin:"https://nofeki.com","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-shortcut-link-code","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Vary":"Origin"}}
function out(req:Request,status:number,data:Record<string,unknown>){return new Response(JSON.stringify(data),{status,headers:cors(req)})}
async function hash(v:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("")}
Deno.serve(async(req:Request)=>{if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(req)});if(req.method!=="POST")return out(req,405,{ok:false,error:"method_not_allowed"});
const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return out(req,500,{ok:false,error:"server_configuration_error"});
let body:any={};try{body=await req.json()}catch{return out(req,400,{ok:false,error:"invalid_json"})}
const code=String(body.code??req.headers.get("x-shortcut-link-code")??"").trim().toLowerCase();if(!/^[a-f0-9]{32}$/.test(code))return out(req,400,{ok:false,error:"invalid_code"});
const base=url.replace(/\/$/,""),digest=await hash(code),now=new Date().toISOString();
const claim=new URL(base+"/rest/v1/shortcut_link_codes");claim.searchParams.set("select","id,user_id,device_name,expires_at");claim.searchParams.set("code_hash","eq."+digest);claim.searchParams.set("used_at","is.null");claim.searchParams.set("expires_at","gt."+now);
const claimed=await fetch(claim,{method:"PATCH",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify({used_at:now})});
if(!claimed.ok){console.error("claim code",claimed.status,(await claimed.text()).slice(0,200));return out(req,500,{ok:false,error:"code_validation_failed"})}
const rows=await claimed.json();if(!Array.isArray(rows)||rows.length!==1)return out(req,401,{ok:false,error:"code_invalid_expired_or_used",message:"El código no es válido, venció o ya fue utilizado. Genera uno nuevo desde NOFEKI."});
const row=rows[0];
const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,"0")).join("");
const tokenHash=await hash(token);
const deviceName=row.device_name||"iPhone NOFEKI";
const expiresAt=new Date(Date.now()+365*24*60*60*1000).toISOString();
const issue=await fetch(base+"/rest/v1/rpc/issue_shortcut_authorization",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({p_user_id:row.user_id,p_token_hash:tokenHash,p_device_name:deviceName,p_expires_at:expiresAt})});
if(!issue.ok){console.error("atomic authorization issue",issue.status,(await issue.text()).slice(0,200));return out(req,500,{ok:false,error:"authorization_creation_failed",message:"El código fue consumido, genera uno nuevo e inténtalo otra vez."})}
const issued=await issue.json();
if(issued!==true)return out(req,409,{ok:false,error:"active_authorization_exists",message:"Esta cuenta ya tiene una autorización activa. Revócala desde NOFEKI antes de volver a vincular."});
return out(req,200,{ok:true,token,device_name:row.device_name||"iPhone NOFEKI",message:"Vinculación completada. Guarda este token de forma privada; solo se muestra una vez."})});