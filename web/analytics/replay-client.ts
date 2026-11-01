export type ReplayConfiguration={enabled:boolean;token:string;host:string;distinctId:string;product:'cloud'|'line'|'x'|'ig'|'threads';internal:boolean;noticeVersion:string};
type Recording={setScreen:(screen:string|null)=>void;stop:()=>void};
type Library={start:(config:ReplayConfiguration,screen:string)=>Recording|undefined};
let loading:Promise<Library>|undefined;
function library(assetPath:string):Promise<Library>{
  if(loading)return loading;
  loading=new Promise<Library>((resolve,reject)=>{
    const script=document.createElement('script');script.src=assetPath;script.async=true;
    script.onload=()=>{const lib=(window as Window&{HarnessReplay?:Library}).HarnessReplay;lib?resolve(lib):reject(new Error('replay_unavailable'));};
    script.onerror=()=>reject(new Error('replay_unavailable'));document.head.appendChild(script);
  }).catch(e=>{loading=undefined;throw e;});
  return loading;
}
/** Poll only a permitted recording in a visible, recently used tab; no permanent disabled polling. */
export function createReplaySession(loadConfig:()=>Promise<ReplayConfiguration|null>,assetPath:string){
  let disposed=false,enabled=false,screen:string|null=null,recording:Recording|undefined,identity='',revision=0;
  let known=false,eligible=false,paused=false,pending=false,lastActivity=Date.now();
  const visible=()=>document.visibilityState==='visible'&&Date.now()-lastActivity<300000;
  function stop(){revision++;recording?.stop();recording=undefined;identity='';paused=false;}
  function pause(){revision++;if(recording&&!paused)recording.setScreen(null);paused=true;}
  async function refresh(){
    if(disposed||!enabled||!screen||!visible()||pending||(known&&!eligible))return;
    const rev=++revision;pending=true;
    try{
      const config=await loadConfig();
      if(rev!==revision||disposed||!enabled||!screen||!visible())return;
      known=true;eligible=config?.enabled===true;
      if(!config?.enabled){stop();return;}
      const nextIdentity=JSON.stringify(config);
      if(recording&&identity===nextIdentity){if(paused){recording.setScreen(screen);paused=false;}return;}
      recording?.stop();recording=undefined;identity='';
      const sdk=await library(assetPath);
      if(rev!==revision||disposed||!enabled||!screen||!visible())return;
      recording=sdk.start(config,screen);identity=nextIdentity;paused=false;
    }catch{if(rev===revision){stop();known=false;eligible=false;}}
    finally{pending=false;}
  }
  const activity=()=>{const wake=Date.now()-lastActivity>=300000||paused;lastActivity=Date.now();if(wake&&enabled&&screen)void refresh();};
  const visibility=()=>{if(document.visibilityState==='hidden')pause();else {lastActivity=Date.now();if(enabled&&screen)void refresh();}};
  const timer=setInterval(()=>{if(!visible()){pause();return;}if(eligible)void refresh();},60000);
  document.addEventListener('visibilitychange',visibility);
  for(const name of ['pointerdown','keydown','wheel','touchstart'])document.addEventListener(name,activity,{passive:true});
  return {
    setScreen(next:string|null){if(next===screen)return;screen=next;if(!next){stop();return;}if(!visible()){pause();return;}if(recording&&!paused)recording.setScreen(next);else if(enabled&&!known)void refresh();},
    setEnabled(next:boolean){if(next===enabled)return;enabled=next;if(!next)stop();else {known=false;eligible=false;lastActivity=Date.now();void refresh();}},
    dispose(){disposed=true;enabled=false;stop();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);for(const name of ['pointerdown','keydown','wheel','touchstart'])document.removeEventListener(name,activity);},
  };
}
