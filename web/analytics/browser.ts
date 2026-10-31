import {createReplaySession,type ReplayConfiguration} from './replay-client';
import { ACTIONS, screenForPath, operationForPath, type Event, type Screen, type Action } from './contract';
export type Preferences={enabled:boolean;choice:'unset'|'on'|'off';privacySignal:boolean};
export type AnalyticsApi=<T>(path:string,options?:RequestInit)=>Promise<{success:boolean;data:T}>;
type Options={api:AnalyticsApi;apiOrigin:string;onPreference?:(p:Preferences)=>void};
const offByBrowser=()=>navigator.doNotTrack==='1'||(navigator as Navigator&{globalPrivacyControl?:boolean}).globalPrivacyControl===true;

/** Explicit enums only. Never inspect DOM text, input values, fetch bodies, response bodies, or full URLs for export. */
export function createTenantTracker({api,apiOrigin,onPreference}:Options){
  let active=false,disposed=false,current:Screen|null=null,queue:Array<{event:Event;at:number}>=[],timer:ReturnType<typeof setTimeout>|undefined;
  let started:number|null=null;let foreground=0,eventsThisMinute=0,minute=Date.now();
  const originalFetch=window.fetch;
  const replay=createReplaySession(async()=>{const r=await api<ReplayConfiguration>('/api/product-analytics/replay-config');return r.success?r.data:null;},(location.pathname==='/console'||location.pathname.startsWith('/console/'))?'/console/harness-replay-v1.js':'/harness-replay-v1.js');
  const announce=(p:Preferences)=>{active=p.enabled&&p.choice!=='off'&&!p.privacySignal&&!offByBrowser();if(!active){queue=[];foreground=0;started=null;}replay.setEnabled(active);onPreference?.(p);};
  function emit(event:Event){
    if(!active||disposed||offByBrowser())return;
    if(Date.now()-minute>=60000){minute=Date.now();eventsThisMinute=0;}
    if(++eventsThisMinute>120||queue.length>=20)return;
    queue.push({event,at:performance.now()});
    if(!timer)timer=setTimeout(()=>void flush(),2000);
  }
  async function flush(){
    clearTimeout(timer);timer=undefined;
    if(!active||offByBrowser()){queue=[];return;}
    const batch=queue.map(({event,at})=>({...event,age_ms:Math.min(60000,Math.max(0,Math.round(performance.now()-at)))}));queue=[];
    if(!batch.length)return;
    // Best effort, no retry: a navigation must never wait on measurement.
    try{await api('/api/product-analytics/events',{method:'POST',body:JSON.stringify({events:batch}),keepalive:true});}catch{/* Analytics is independent of business operations. */}
  }
  function leave(){
    if(started!==null)foreground+=Math.max(0,performance.now()-started);
    if(current&&foreground>0)emit({kind:'engagement',screen:current,duration:foreground<10000?'under_10s':foreground<60000?'10_to_60s':foreground<300000?'1_to_5m':'over_5m'});
    foreground=0;started=null;
  }
  function setScreen(path:string){
    const next=screenForPath(path);
    if(next===current)return;
    leave();current=next;replay.setScreen(next);
    if(current){emit({kind:'screen',screen:current});started=active&&document.visibilityState==='visible'?performance.now():null;}
  }
  function action(action:Action){if(current&&ACTIONS.includes(action))emit({kind:'action',screen:current,action});}
  function interact(event:globalThis.Event){
    const target=event.target instanceof Element?event.target:null;
    if(!target)return;
    const item=target.closest('[data-harness-action]');
    if(item){
      const expected=item.getAttribute('data-harness-event')||'click';
      const value=item.getAttribute('data-harness-action');
      if(event.type===expected&&value&&ACTIONS.includes(value as Action))action(value as Action);
      return;
    }
    if(event.type==='click'){
      const link=target.closest('a[href]');
      if(link)try{const url=new URL(link.getAttribute('href')!,location.href);if(url.origin===location.origin&&screenForPath(url.pathname))action('navigate');}catch{/* Ignore unknown links. */}
    }
  }
  const visibility=()=>{
    if(document.visibilityState==='hidden'){if(started!==null)foreground+=Math.max(0,performance.now()-started);started=null;void flush();}
    else if(active)started=performance.now();
  };
  const pagehide=()=>{leave();void flush();};
  const wrappedFetch:typeof fetch=async(input,init)=>{
    const screen=current;
    let operation:ReturnType<typeof operationForPath>=null;
    try{
      const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
      if(url.origin===apiOrigin)operation=operationForPath((init?.method??(input instanceof Request?input.method:'GET')).toUpperCase(),url.pathname);
    }catch{/* Nonstandard request remains untouched. */}
    const start=performance.now();
    try{
      const result=await originalFetch.call(window,input,init);
      if(screen&&operation&&((result.status>=200&&result.status<300)||result.status>=400)){
        const ms=performance.now()-start;
        emit({kind:'operation',screen,operation,status:result.status,outcome:result.status<300?'accepted':result.status<500?'rejected':'server_error',duration:ms<1000?'under_1s':ms<5000?'1_to_5s':'over_5s'});
      }
      return result;
    }catch(error){
      if(screen&&operation)emit({kind:'operation',screen,operation,status:0,outcome:'network_error',duration:performance.now()-start<1000?'under_1s':performance.now()-start<5000?'1_to_5s':'over_5s'});
      throw error;
    }
  };
  window.fetch=wrappedFetch;
  document.addEventListener('click',interact,true);
  document.addEventListener('change',interact,true);
  document.addEventListener('focusin',interact,true);
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pagehide',pagehide);
  const ready=api<Preferences>('/api/product-analytics/preferences').then(r=>{
    if(disposed)return;
    announce(r.success?r.data:{enabled:false,choice:'unset',privacySignal:false});
    if(active&&current){emit({kind:'screen',screen:current});started=document.visibilityState==='visible'?performance.now():null;}
  }).catch(()=>{if(!disposed)announce({enabled:false,choice:'unset',privacySignal:false});});
  return {ready,setScreen,action,flush,
    async choose(choice:'on'|'off'){
      // Stop locally before awaiting a network response. Failure cannot keep collecting after a stop click.
      if(choice==='off'){replay.setEnabled(false);active=false;queue=[];started=null;foreground=0;}
      const r=await api<Preferences>('/api/product-analytics/preferences',{method:'POST',body:JSON.stringify({choice})});
      if(!r.success)throw new Error('analytics_preference_failed');
      if(!disposed){announce(r.data);if(active&&current){emit({kind:'screen',screen:current});started=document.visibilityState==='visible'?performance.now():null;}}
      return r.data;
    },
    dispose(){
      replay.dispose();leave();void flush();disposed=true;clearTimeout(timer);
      if(window.fetch===wrappedFetch)window.fetch=originalFetch;
      document.removeEventListener('click',interact,true);document.removeEventListener('change',interact,true);document.removeEventListener('focusin',interact,true);
      document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);
    },
  };
}
