// Isolated runtime check: synthetic credentials, ephemeral D1, intercepted Meta.
// The test-only tick route is bundled here, never included in production.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as miniflare from 'miniflare';
const root=fileURLToPath(new URL('../',import.meta.url));
const {outputFiles}=await build({stdin:{contents:`import {app,processPost} from './src/index'; export {ThreadsPublisher} from './src/index'; export default {async fetch(req,env,ctx){const u=new URL(req.url);if(u.pathname==='/__tick'){const p=await env.DB.prepare('SELECT * FROM threads_posts WHERE id=?').bind(u.searchParams.get('id')).first();await processPost(env,p);return Response.json({ok:true});}return app.fetch(req,env,ctx);}};`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser'});
const containers=new Map();let nextId=100, publications=0;
const options={modules:true,script:outputFiles[0].text,compatibilityDate:'2026-08-27',d1Databases:['DB'],durableObjects:{PUBLISHER:{className:'ThreadsPublisher',useSQLite:true}},bindings:{API_KEY:'fixture-key',TOKEN_ENCRYPTION_KEY:btoa('12345678901234567890123456789012')},
 async outboundService(req){
  const u=new URL(req.url);assert.equal(u.origin,'https://graph.threads.net');assert.equal(req.headers.get('Authorization'),'Bearer fixture-token');
  if(u.pathname.endsWith('/me'))return Response.json({id:'456',username:'fixture'});
  if(u.pathname.endsWith('/debug_token'))return Response.json({data:{type:'USER',user_id:'456',is_valid:true,scopes:['threads_basic','threads_content_publish','threads_manage_insights'],expires_at:Math.floor(Date.now()/1000)+3600}});
  if(u.pathname.endsWith('/threads_publishing_limit'))return Response.json({data:[{quota_usage:0,config:{quota_total:250,quota_duration:86400}}]});
  if(req.method==='POST'){
   const body=Object.fromEntries(new URLSearchParams(await req.text()));
   if(u.pathname.endsWith('/threads')){
    assert.ok(['IMAGE','VIDEO','CAROUSEL'].includes(body.media_type));
    if(body.media_type==='CAROUSEL'){
     const children=body.children.split(',');assert.equal(children.length,2);
     assert.equal(containers.get(children[0]).media_type,'IMAGE');assert.equal(containers.get(children[1]).media_type,'VIDEO');
     assert.ok(children.every(id=>containers.get(id).is_carousel_item==='true'));
    }else assert.equal(body[body.media_type==='IMAGE'?'image_url':'video_url'],body.media_type==='IMAGE'?'https://cdn.example.com/a.png':'https://cdn.example.com/a.mp4');
    const id=String(++nextId);containers.set(id,body);return Response.json({id});
   }
   if(u.pathname.endsWith('/threads_publish')){assert.ok(containers.has(body.creation_id));assert.notEqual(containers.get(body.creation_id).is_carousel_item,'true');publications++;return Response.json({id:String(900+publications)});}
  }
  if(req.method==='GET'&&containers.has(u.pathname.split('/').pop()))return Response.json({status:'FINISHED'});
  throw Error('Unexpected fixture request');
 }};
const mf=new miniflare.Miniflare(miniflare.convertV4MiniflareOptions?miniflare.convertV4MiniflareOptions(options):options);
try{
 const db=await mf.getD1Database('DB');
 for(const file of (await readdir(root+'/migrations')).filter(f=>f.endsWith('.sql')).sort()){
  for(const stmt of (await readFile(root+'/migrations/'+file,'utf8')).replace(/^\s*--[^\n]*/gm,'').split(';').filter(s=>s.trim()))await db.prepare(stmt).run();
 }
 const api=(path,method='GET',body)=>mf.dispatchFetch('http://localhost/api'+path,{method,headers:{Authorization:'Bearer fixture-key','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal((await api('/accounts','POST',{accessToken:'fixture-token'})).status,201);
 const image={type:'IMAGE',url:'https://cdn.example.com/a.png'},video={type:'VIDEO',url:'https://cdn.example.com/a.mp4'};
 for(const media of [[image],[video],[image,video]]){
  const created=await api('/posts','POST',{accountId:'456',text:'',media});assert.equal(created.status,201);const id=(await created.json()).data.id;
  assert.equal((await api(`/posts/${id}/queue`,'POST',{scheduledAt:new Date(Date.now()+600000).toISOString()})).status,200);
  let row;
  for(let i=0;i<8;i++){await mf.dispatchFetch('http://localhost/__tick?id='+id);row=await db.prepare('SELECT * FROM threads_posts WHERE id=?').bind(id).first();if(row.status==='published')break;}
  assert.equal(row.status,'published');assert.ok(row.published_id);assert.deepEqual(JSON.parse(row.media_json),media);
 }
 assert.equal(publications,3);assert.equal(containers.size,5);
 console.log(JSON.stringify({runtime:'workerd',image:true,video:true,mixedCarousel:true,simulatedPublications:publications,containers:containers.size,liveMetaRequests:0}));
}finally{await mf.dispose();}
