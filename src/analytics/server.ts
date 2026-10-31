import { Hono, type Context, type Env } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { validateEvent, type WireEvent } from './contract';

export interface AnalyticsBindings { PRODUCT_ANALYTICS_ENABLED?:string; PRODUCT_ANALYTICS_INTERNAL?:string; POSTHOG_HOST?:string; POSTHOG_PROJECT_TOKEN?:string; ADMIN_SSO_SECRET?:string; ADMIN_ORIGIN?:string; }
type Product='line'|'x'|'ig'|'threads';
type Actor={id:string;role:'owner'|'admin'|'editor'|'viewer'|'staff'};
const cookieName='__Host-harness_analytics';
const hosts=new Set(['https://us.i.posthog.com','https://eu.i.posthog.com']);
const configured=(env:AnalyticsBindings)=>env.PRODUCT_ANALYTICS_ENABLED==='true'&&hosts.has(env.POSTHOG_HOST??'')&&/^phc_[\w-]{10,200}$/.test(env.POSTHOG_PROJECT_TOKEN??'')&&Boolean(env.ADMIN_SSO_SECRET);
async function digest(secret:string,value:string){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
async function preference<E extends Env & {Bindings:AnalyticsBindings}>(c:Context<E>,id:string){
  const raw=c.req.header('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if(!raw)return 'unset' as const;
  const [choice,owner,exp,signature]=raw.split('.');
  if(!['on','off'].includes(choice)||!/^\d+$/.test(exp??'')||!signature)return 'off' as const;
  const expected=await digest(c.env.ADMIN_SSO_SECRET!,'harness-choice-v1\0'+[choice,owner,exp].join('.'));
  if(signature!==expected)return 'off' as const;
  if(owner!==id)return 'unset' as const;
  if(choice==='off')return 'off' as const;
  return Number(exp)>Date.now()/1000?'on' as const:'unset' as const;
}
export function tenantAnalyticsRoutes<E extends Env & {Bindings:AnalyticsBindings}>(product:Product,actorFor:(c:Context<E>)=>Actor|null){
  const app=new Hono<E>();
  app.use('*',bodyLimit({maxSize:16384}));
  app.use('*',async(c,next)=>{c.header('Cache-Control','no-store');await next();});
  const state=async(c:Context<E>)=>{
    const actor=actorFor(c);
    if(!actor)return null;
    const enabled=configured(c.env);
    if(!enabled)return {enabled:false,choice:'unset' as const,privacySignal:false,actor,id:'',workspace:''};
    const id=await digest(c.env.ADMIN_SSO_SECRET!,'harness-actor-v1\0'+product+'\0'+actor.id);
    return {enabled:true,choice:await preference(c,id),privacySignal:c.req.header('DNT')==='1'||c.req.header('Sec-GPC')==='1',actor,id,
      workspace:await digest(c.env.ADMIN_SSO_SECRET!,'harness-workspace-v1\0'+product)};
  };
  app.get('/preferences',async c=>{
    const s=await state(c);if(!s)return c.json({success:false,error:'Unauthorized'},401);
    return c.json({success:true,data:{enabled:s.enabled,choice:s.choice,privacySignal:s.privacySignal}});
  });
  app.use('*',async(c,next)=>{
    if(c.req.method!=='POST')return next();
    const origin=c.req.header('Origin');
    const allowed=[new URL(c.req.url).origin,...(c.env.ADMIN_ORIGIN??'').split(',').map(v=>v.trim()).filter(Boolean)];
    if(!origin||!allowed.includes(origin)||!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json'))return c.json({success:false,error:'Forbidden'},403);
    await next();
  });
  app.post('/preferences',async c=>{
    const s=await state(c);if(!s)return c.json({success:false,error:'Unauthorized'},401);
    if(!s.enabled)return c.json({success:false,error:'disabled'},404);
    const b=await c.req.json().catch(()=>null);
    if(!b||Object.keys(b).length!==1||!['on','off'].includes(b.choice))return c.json({success:false,error:'invalid_choice'},400);
    const value=[b.choice,s.id,Math.floor(Date.now()/1000)+90*86400].join('.');
    const sig=await digest(c.env.ADMIN_SSO_SECRET!,'harness-choice-v1\0'+value);
    c.header('Set-Cookie',`${cookieName}=${value}.${sig}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${90*86400}`);
    return c.json({success:true,data:{enabled:true,choice:b.choice,privacySignal:s.privacySignal}});
  });
  app.post('/events',async c=>{
    const s=await state(c);if(!s)return c.json({success:false,error:'Unauthorized'},401);
    if(!s.enabled||s.choice==='off'||s.privacySignal)return c.json({success:true,data:{accepted:0}});
    const body=await c.req.json().catch(()=>null);
    if(!body||Object.keys(body).length!==1||!Array.isArray(body.events)||body.events.length<1||body.events.length>20||!body.events.every(validateEvent))return c.json({success:false,error:'invalid_events'},400);
    const receivedAt=Date.now();
    const batch=(body.events as WireEvent[]).map(e=>{const {age_ms,...safe}=e;return {event:'thc_tenant_'+e.kind,distinct_id:'tenant_'+s.id,uuid:crypto.randomUUID(),timestamp:new Date(receivedAt-age_ms).toISOString(),
      properties:{...safe,product,source:'tenant_console',schema_version:1,environment:'production',internal:c.env.PRODUCT_ANALYTICS_INTERNAL==='true',actor_scope:'credential',evidence:e.kind==='operation'?'browser_http_response':'browser_interaction',role:s.actor.role,workspace:'workspace_'+s.workspace,
        $process_person_profile:false,$geoip_disable:true,$ip:null}};});
    try {c.executionCtx.waitUntil((async()=>{try{
      const r=await fetch(c.env.POSTHOG_HOST+'/batch/',{method:'POST',redirect:'error',signal:AbortSignal.timeout(2000),headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:c.env.POSTHOG_PROJECT_TOKEN,batch})});
      if(!r.ok)console.warn('tenant_analytics: delivery_failed');await r.body?.cancel();
    }catch{console.warn('tenant_analytics: delivery_failed');}})());}catch{/* No execution context: do not send. */}
    return c.json({success:true,data:{accepted:batch.length}});
  });
  return app;
}
