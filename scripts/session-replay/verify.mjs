import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {gunzipSync,strFromU8} from 'fflate';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const source=await readFile(new URL('./dist/harness-replay-v1.js',import.meta.url),'utf8');
test('actual SDK masks full snapshots and mutations before any ingestion request',async(t)=>{
 const dom=new JSDOM('<html><head><title>PRIVATE_TITLE</title></head><body><main><div id="PRIVATE_ID" class="PRIVATE_CLASS" title="PRIVATE_ATTR">PRIVATE_CUSTOMER</div><textarea>PRIVATE_CHAT</textarea><input value="PRIVATE_INPUT"><input type="hidden" value="PRIVATE_TOKEN"><img src="https://private.example/PRIVATE_IMAGE"><a href="https://private.example/PRIVATE_LINK">PRIVATE_LINK_TEXT</a></main></body></html>',{url:'https://tenant.example/console/chats/PRIVATE_PATH?key=PRIVATE_QUERY#PRIVATE_HASH',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,requests=[],controllers=[];
 t.after(()=>{for(const c of controllers)c?.stop();dom.window.close();});
 const style=w.document.createElement('style');style.textContent='.public-layout { display: flex; background-image: url(https://private.example/PRIVATE_CSS_URL); }';w.document.head.append(style);
 const sheet=style.sheet;style.remove();
 const link=w.document.createElement('link');link.rel='stylesheet';link.href='/assets/layout.css';Object.defineProperty(link,'sheet',{value:sheet});w.document.head.append(link);
 w.document.querySelector('div').className='public-layout PRIVATE_CLASS';
 w.fetch=async(url,init={})=>{requests.push({url:String(url),init});return new Response(JSON.stringify({sessionRecording:{sampleRate:'1',minimumDurationMilliseconds:0,consoleLogRecordingEnabled:false},autocapture_opt_out:true,featureFlags:{},supportedCompression:[]}),{headers:{'content-type':'application/json'}});};
 w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
 w.eval(source+'\nwindow.HarnessReplay=HarnessReplay;');
 const controller=w.HarnessReplay.start({enabled:true,token:'phc_synthetic_replay_test',host:'https://us.i.posthog.com',distinctId:'tenant_'+'a'.repeat(64),product:'line',internal:true,noticeVersion:'2026-11-01.3'},'chats');
 controllers.push(controller);assert.ok(controller);
 await wait(1000);
 w.document.querySelector('div').textContent='PRIVATE_MUTATION';
 w.document.querySelector('div').setAttribute('title','PRIVATE_MUTATION_ATTR');
 const el=w.document.createElement('p');el.textContent='PRIVATE_ADDED';w.document.body.append(el);
 w.document.querySelector('input').value='PRIVATE_NEW_INPUT';w.document.querySelector('input').dispatchEvent(new w.Event('input',{bubbles:true}));
 w.document.querySelector('a').addEventListener('click',e=>e.preventDefault());
 w.document.querySelector('a').dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true,clientX:30,clientY:50}));
 await wait(12000);
 const payloads=[];
 for(const r of requests){
  if(!r.init.body)continue;
  let body=r.init.body;
  if(typeof body!=='string'){
   if(body.arrayBuffer)body=new Uint8Array(await body.arrayBuffer());
   else body=new Uint8Array(body);
   try{body=strFromU8(gunzipSync(body));}catch{body=strFromU8(body);}
  }
  payloads.push(body);
 }

 const all=JSON.stringify(payloads);
 const events=payloads.flatMap(p=>{const parsed=JSON.parse(p);return Array.isArray(parsed)?parsed:parsed.batch??[parsed];});
 const snapshots=events.filter(e=>e.event==='$snapshot').flatMap(e=>e.properties.$snapshot_data);
 assert.ok(snapshots.some(s=>s.type===4&&s.data.href==='https://harness.invalid/line/chats'),'initial viewport and safe URL metadata retained');
 assert.ok(snapshots.some(s=>s.type===2),'full snapshot retained');
 assert.equal(snapshots.find(s=>s.type===2).data.node.compatMode,w.document.compatMode,'document rendering mode retained');
 assert.ok(snapshots.some(s=>s.type===3&&s.data.source===0),'DOM mutations retained');
 assert.ok(snapshots.some(s=>s.type===3&&s.data.source===5),'masked input interaction retained');
 assert.ok(snapshots.some(s=>s.type===3&&s.data.source===2),'click coordinates retained');
 assert.ok(events.every(e=>e.properties.$session_id&&e.properties.$window_id));
 assert.equal(w.document.querySelector('meta[name=referrer]').content,'no-referrer');
 assert.doesNotMatch(all,/PRIVATE_|private\.example|tenant\.example/);
 assert.match(all,/\$snapshot_data/,'real SDK must transmit a recording, not merely drop it');
 assert.match(all,/harness\.invalid/);
 assert.match(all,/public-layout/,'public CSS class layout retained');
 assert.match(all,/display: flex/,'public inline stylesheet retained');
 controller.stop();
 const count=requests.length;w.document.body.append(w.document.createTextNode('PRIVATE_AFTER_STOP'));
 await wait(3500);assert.equal(requests.length,count,'stop prevents further requests');
 const resumed=w.HarnessReplay.start({enabled:true,token:'phc_synthetic_replay_test',host:'https://us.i.posthog.com',distinctId:'tenant_'+'a'.repeat(64),product:'line',internal:true,noticeVersion:'2026-11-01.3'},'chats');
 controllers.push(resumed);await wait(1000);w.document.querySelector('div').textContent='PRIVATE_RESUMED';await wait(10000);
 const resumedEvents=requests.slice(count).filter(r=>new URL(r.url).pathname==='/s/').flatMap(r=>JSON.parse(r.init.body));
 assert.ok(resumedEvents.some(e=>e.properties.$session_id!==events[0].properties.$session_id&&e.properties.$snapshot_data.some(s=>s.type===2)),'authorized remount must start a new recording with a full frame');
 assert.doesNotMatch(JSON.stringify(resumedEvents),/PRIVATE_|tenant\.example/);
 resumed.stop();dom.window.close();
});

test('disabled capture and privacy signals do not load config or send anything',()=>{
 const dom=new JSDOM('<body>PRIVATE</body>',{url:'https://tenant.example/console/chats',runScripts:'outside-only'});
 const w=dom.window;let requests=0;w.fetch=()=>{requests++;throw Error('unexpected');};w.eval(source+'\nwindow.HarnessReplay=HarnessReplay;');
 const config={enabled:false,token:'phc_synthetic_replay_test',host:'https://us.i.posthog.com',distinctId:'tenant_'+'a'.repeat(64),product:'line',internal:true,noticeVersion:'2026-11-01.3'};
 assert.equal(w.HarnessReplay.start(config,'chats'),undefined);
 Object.defineProperty(w.navigator,'globalPrivacyControl',{value:true});
 assert.equal(w.HarnessReplay.start({...config,enabled:true},'chats'),undefined);
 assert.equal(requests,0);dom.window.close();
});
