import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const H = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-shortcut-token, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Content-Type":"application/json; charset=utf-8"};
const reply=(status:number, body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:H});
async function hash(s:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");}
const defaults=[
{name:"Alimentación",icon:"🍽️",description:"Mercado y comidas"},
{name:"Transporte",icon:"🚗",description:"Movilidad y transporte"},
{name:"Vivienda",icon:"🏠",description:"Arriendo y hogar"},
{name:"Servicios",icon:"💡",description:"Servicios y facturas"},
{name:"Deudas",icon:"💳",description:"Cuotas y obligaciones"},
{name:"Ocio",icon:"🎉",description:"Entretenimiento y salidas"},
{name:"Salud",icon:"🩺",description:"Salud y bienestar"},
{name:"Compras",icon:"🛍️",description:"Compras personales"},
{name:"Otros",icon:"🏷️",description:"Otros gastos"}];
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:H});
 if(!["GET","POST"].includes(req.method))return reply(405,{ok:false,error:"method_not_allowed"});
 const base=Deno.env.get("SUPABASE_URL"); const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!base||!key)return reply(500,{ok:false,error:"server_configuration_error"});
 const raw=req.headers.get("X-Shortcut-Token")??req.headers.get("Authorization")??"";
 const token=raw.toLowerCase().startsWith("bearer ")?raw.slice(7).trim():raw.trim();
 if(token.length<32||token.length>512)return reply(200,{ok:false,error:"invalid_authorization"});
 const h={apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"};
 try{
  const root=base.replace(/\/$/,"");
  const au=new URL(root+"/rest/v1/shortcut_authorizations");
  au.searchParams.set("select","user_id,expires_at");au.searchParams.set("token_hash","eq."+await hash(token));au.searchParams.set("revoked_at","is.null");au.searchParams.set("limit","1");
  const ar=await fetch(au,{headers:h,signal:AbortSignal.timeout(12000)});
  if(!ar.ok)return reply(502,{ok:false,error:"authorization_check_failed",upstream_status:ar.status});
  const rows=await ar.json();if(!Array.isArray(rows)||rows.length!==1)return reply(200,{ok:false,error:"unauthorized_or_revoked"});
  const auth=rows[0];if(auth.expires_at&&Date.parse(auth.expires_at)<=Date.now())return reply(200,{ok:false,error:"authorization_expired"});
  const cu=new URL(root+"/rest/v1/user_expense_categories");
  cu.searchParams.set("select","id,name,icon,description");cu.searchParams.set("user_id","eq."+auth.user_id);cu.searchParams.set("order","name.asc");
  const cr=await fetch(cu,{headers:h,signal:AbortSignal.timeout(12000)});
  if(!cr.ok){const detail=(await cr.text()).slice(0,250);console.error("categories lookup",cr.status,detail);return reply(502,{ok:false,error:"categories_lookup_failed",upstream_status:cr.status,detail});}
  const custom=await cr.json();const map=new Map<string,Record<string,unknown>>();
  for(const c of defaults)map.set(c.name.toLocaleLowerCase("es"),{...c,custom:false});
  for(const c of (Array.isArray(custom)?custom:[])){if(typeof c.name!=="string"||!c.name.trim())continue;const k=c.name.trim().toLocaleLowerCase("es");if(!map.has(k))map.set(k,{id:c.id,name:c.name.trim(),icon:c.icon||"🏷️",description:c.description||"",custom:true});}
  const categories=[...map.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name),"es"));
  return reply(200,{ok:true,categories,count:categories.length});
 }catch(e){console.error("categories handler",e);return reply(500,{ok:false,error:"internal_error"});}
});