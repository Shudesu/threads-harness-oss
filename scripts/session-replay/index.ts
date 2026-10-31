import posthog, {type PostHog,type PostHogConfig} from 'posthog-js/full/no-external';
import {createPrivacy} from './privacy';
export type ReplayConfig={enabled:boolean;token:string;host:string;distinctId:string;product:'cloud'|'line'|'x'|'ig'|'threads';internal:boolean;noticeVersion:string};
const screens=new Set('workspaces workspace_new overview connections agent line_accounts campaigns apps coupon collection x_research dashboard chats friends posts compose schedule insights accounts settings integrations broadcasts scenarios tags forms media rich_messages rich_menus staff webinars bookings automation personal_line replies quotes growth notifications templates reminders scoring affiliates conversions health updates users pools webhooks events'.split(' '));
const signal=()=>navigator.doNotTrack==='1'||(navigator as Navigator&{globalPrivacyControl?:boolean}).globalPrivacyControl===true;
type Controller={setScreen:(screen:string|null)=>void;stop:()=>void};
let active:Controller|undefined;
let generation=0;
let instance:PostHog|undefined,connection='';
export function start(config:ReplayConfig,initialScreen:string):Controller|undefined{
  active?.stop();
  if(!config.enabled||signal()||config.noticeVersion!=='2026-11-01.3'||!['https://us.i.posthog.com','https://eu.i.posthog.com'].includes(config.host)||!/^phc_[\w-]{10,200}$/.test(config.token)||!/^(?:tenant|thc)_[a-f0-9]{64}$/.test(config.distinctId)||!['cloud','line','x','ig','threads'].includes(config.product))return undefined;
  let stopped=false,screen=screens.has(initialScreen)?initialScreen:null;
  const privacy=createPrivacy();
  // SDK config and ingestion requests must not carry the tenant URL as a Referer.
  const referrer=document.createElement('meta');referrer.name='referrer';referrer.content='no-referrer';document.head.append(referrer);
  const href=()=>`https://harness.invalid/${config.product}/${screen??'unknown'}`;
  const options:Partial<PostHogConfig>={
    api_host:config.host,defaults:'2026-08-30',persistence:'memory',person_profiles:'never',
    bootstrap:{distinctID:config.distinctId,isIdentifiedID:false},
    ip:false,save_referrer:false,capture_exceptions:false,
    autocapture:false,capture_pageview:false,capture_pageleave:false,rageclick:false,
    capture_dead_clicks:false,capture_performance:false,enable_recording_console_log:false,
    disable_surveys:true,disable_product_tours:true,disable_conversations:true,
    disable_external_dependency_loading:true,advanced_disable_feature_flags:true,
    disable_session_recording:true,
    session_recording:{
      maskAllInputs:true,maskTextSelector:'*',maskTextFn:()=> '••••',maskInputFn:()=> '••••',
      maskAttributeFn:privacy.attribute,
      blockSelector:'img,svg,canvas,video,audio,iframe,object,embed,input[type="hidden"],input[type="file"],script,style,[data-replay-private]',
      recordCrossOriginIframes:false,collectFonts:false,captureJsonLd:false,
      recordHeaders:false,recordBody:false,compress_events:false,
      // The callback also handles replay Meta events. Returning null can drop the
      // initial viewport/URL frame, so retain the shape with a fixed synthetic URL.
      maskCapturedNetworkRequestFn:data=>({...data,name:href()}),
      canvasCapture:{maskRegionsFn:()=>null},
    },
    before_send:event=>{
      if(stopped||!screen||signal()||!event||!['$snapshot','$pageview'].includes(event.event))return null;
      const p=event.properties;
      const properties:Record<string,unknown>={token:config.token,distinct_id:config.distinctId,
        $session_id:p.$session_id,$window_id:p.$window_id,$lib:'web',$lib_version:'1.444.0',
        $current_url:href(),$snapshot_host:'harness.invalid',$config_defaults:'2026-08-30',$process_person_profile:false,$geoip_disable:true,$ip:null,
        product:config.product,screen,source:config.product==='cloud'?'cloud_console':'tenant_console',
        environment:'production',internal:config.internal===true,replay_privacy_version:1};
      if(event.event==='$snapshot'){
        if(!Array.isArray(p.$snapshot_data))return null; // Never forward opaque/compressed snapshots.
        const snapshots=p.$snapshot_data.map(v=>privacy.snapshot(v,href())).filter(Boolean);
        if(!snapshots.length)return null;
        properties.$snapshot_data=snapshots;properties.$snapshot_bytes=new Blob([JSON.stringify(snapshots)]).size;
      }
      return {event:event.event,uuid:event.uuid,timestamp:event.timestamp,properties};
    },
  };
  let client:PostHog|undefined;
  const key=config.host+'|'+config.token;
  if(instance&&connection===key){instance.reset();instance.set_config(options);client=instance;}
  else {client=posthog.init(config.token,options,'harness_masked_replay_'+(++generation));instance=client;connection=key;}
  if(!client)return undefined;
  // Authenticated server preference is authoritative. A previous local lifecycle
  // stop must not make a permitted new mount permanently opt out of this SDK.
  client.opt_in_capturing({captureEventName:false});
  function setScreen(next:string|null){
    screen=next&&screens.has(next)?next:null;
    if(!screen||stopped||signal()){client!.stopSessionRecording();return;}
    client!.startSessionRecording();client!.capture('$pageview');
  }
  function stop(){if(stopped)return;stopped=true;client!.stopSessionRecording();client!.opt_out_capturing();clearInterval(timer);window.removeEventListener('pagehide',stop);}
  const timer=setInterval(()=>{if(signal())stop();},1000);
  window.addEventListener('pagehide',stop);
  const controller={setScreen,stop};active=controller;setScreen(screen);return controller;
}
