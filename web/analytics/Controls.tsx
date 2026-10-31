'use client'
import {useEffect,useRef,useState} from 'react';
import {createTenantTracker,type AnalyticsApi,type Preferences} from './browser';

/** Mounted only inside the host application's authenticated shell. */
export function TenantAnalytics({path,api,apiOrigin,showSettings=false}:{path:string;api:AnalyticsApi;apiOrigin:string;showSettings?:boolean}){
  const tracker=useRef<ReturnType<typeof createTenantTracker>|null>(null);
  const latestPath=useRef(path);latestPath.current=path;
  const [preference,setPreference]=useState<Preferences|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  useEffect(()=>{
    const t=createTenantTracker({api,apiOrigin,onPreference:setPreference});tracker.current=t;t.setScreen(latestPath.current);
    return()=>{t.dispose();tracker.current=null;};
  },[api,apiOrigin]);
  useEffect(()=>{tracker.current?.setScreen(path);},[path]);
  async function choose(choice:'on'|'off'){
    if(!tracker.current)return;
    setBusy(true);setError(false);
    try{await tracker.current.choose(choice);}catch{setError(true);}finally{setBusy(false);}
  }
  if(!showSettings||!preference?.enabled)return null;
  return <details style={{margin:'1rem 0',padding:'0.75rem',fontSize:'0.875rem'}}>
    <summary>利用状況の計測 / Usage analytics — {preference.choice==='off'||preference.privacySignal?'停止中 / Off':'計測中 / On'}</summary>
    <p>画面の種類、主要な操作、API応答・時間区分をサービス改善のためPostHogへ送信します。会話本文・顧客名・入力内容・画像・URL・APIキー・画面録画は送りません。停止しても機能は変わりません。</p>
    <p>We measure screen categories, explicit actions, API outcomes and duration buckets. No conversation text, customer names, input values, images, URLs, keys or recordings are collected. Stopping does not affect features.</p>
    <a href="https://theharness.cloud/product-analytics/privacy" target="_blank" rel="noreferrer">送信先・保存・停止について / Privacy details</a>
    {preference.privacySignal&&<p>ブラウザのプライバシー設定により停止しています。 / Disabled by your browser privacy signal.</p>}
    <div style={{display:'flex',gap:'0.75rem',marginTop:'0.75rem'}}>
      <button type="button" disabled={busy||preference.choice==='off'} onClick={()=>void choose('off')}>計測を停止 / Stop</button>
      <button type="button" disabled={busy||preference.choice!=='off'||preference.privacySignal} onClick={()=>void choose('on')}>計測を再開 / Resume</button>
    </div>
    {error&&<p role="alert">設定の保存を確認できませんでした。再度お試しください。 / Could not confirm the setting. Please try again.</p>}
  </details>;
}
