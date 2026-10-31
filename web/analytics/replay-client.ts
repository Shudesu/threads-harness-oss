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
/** Authenticated config is refreshed while recording. Never pass business credentials to the SDK. */
export function createReplaySession(loadConfig:()=>Promise<ReplayConfiguration|null>,assetPath:string){
  let disposed=false,enabled=false,screen:string|null=null,recording:Recording|undefined,identity='',revision=0;
  function stop(){revision++;recording?.stop();recording=undefined;identity='';}
  async function refresh(){
    const rev=++revision;
    if(disposed||!enabled||!screen){stop();return;}
    try{
      const config=await loadConfig();
      if(rev!==revision||disposed||!enabled||!screen)return;
      if(!config?.enabled){stop();return;}
      const nextIdentity=JSON.stringify(config);
      if(recording&&identity===nextIdentity)return;
      recording?.stop();recording=undefined;identity='';
      const sdk=await library(assetPath);
      if(rev!==revision||disposed||!enabled||!screen)return;
      recording=sdk.start(config,screen);identity=nextIdentity;
    }catch{if(rev===revision)stop();}
  }
  const timer=setInterval(()=>void refresh(),60000);
  return {
    setScreen(next:string|null){screen=next;recording?.setScreen(next);if(!next)stop();else if(enabled&&!recording)void refresh();},
    setEnabled(next:boolean){enabled=next;if(!next)stop();else void refresh();},
    dispose(){disposed=true;enabled=false;stop();clearInterval(timer);},
  };
}
