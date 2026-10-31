// A second boundary after rrweb masking. Unknown event types / fields are dropped.
// This is intentionally independent of project settings and remote feature flags.
type Obj=Record<string,any>;
const record=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<1e16?v:0;
const tags=new Set('html head body div span main nav aside header footer section article p a button input textarea select option label form ul ol li table thead tbody tr td th h1 h2 h3 h4 h5 h6 details summary dialog progress br hr link'.split(' '));
const mask=(text:unknown)=>typeof text==='string'&&text.trim()?'••••':'';
export function createPrivacy(){
  const classes=new Set<string>(),styles=new Set<string>();
  const trustedSheet=(element?:Element)=>{
    if(element?.tagName!=='LINK'||element.getAttribute('rel')!=='stylesheet')return false;
    try {const u=new URL(element.getAttribute('href')??'',location.href);return u.origin===location.origin&&!u.search&&!u.hash&&/^\/(?:console\/)?(?:_next\/static\/css|assets)\/[a-zA-Z0-9_.-]+\.css$/.test(u.pathname);}catch{return false;}
  };
  const publicCSS=(value:string)=>{
    // Only bundled public CSS reaches here. Never inline user style elements.
    // Remove resource URLs, imports, source comments and generated text.
    const css=value.replace(/\/\*[\s\S]*?\*\//g,'').replace(/@import[^;]+;/gi,'').replace(/url\([^)]*\)/gi,'none').replace(/(?:content|src)\s*:[^;}]+[;}]?/gi,m=>m.endsWith('}')?'}':'');
    // Escaped identifiers are not needed for the conservative class allowlist.
    for(const m of css.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g))classes.add(m[1]);
    styles.add(css);return css;
  };
  for(const el of Array.from(document.querySelectorAll('link[rel=stylesheet]'))){
    try{const sheet=(el as HTMLLinkElement).sheet;if(trustedSheet(el)&&sheet)publicCSS(Array.from(sheet.cssRules,r=>r.cssText).join(''));}catch{/* Cross-origin styles are never read. */}
  }
  const safeClass=(value:unknown)=>typeof value==='string'?value.split(/\s+/).filter(v=>classes.has(v)).join(' '):'';
  function attribute(name:string,value:string,element?:Element):string{
    if(name==='_cssText'&&trustedSheet(element)){try{const sheet=(element as HTMLLinkElement).sheet;return sheet?publicCSS(Array.from(sheet.cssRules,r=>r.cssText).join('')):'';}catch{return '';}}
    if(name==='class')return safeClass(value);
    // rrweb-generated placeholder dimensions, never arbitrary styles/attributes.
    if((name==='rr_width'||name==='rr_height')&&/^\d+(?:\.\d+)?px$/.test(value))return value;
    return '';
  }
  function attributes(raw:unknown){
    const out:Obj={};if(!record(raw))return out;
    for(const [k,v]of Object.entries(raw)){
      if(k==='class')out[k]=safeClass(v);
      else if(k==='_cssText'&&typeof v==='string'&&styles.has(v))out[k]=v;
      else if(['rr_width','rr_height'].includes(k)&&typeof v==='string'&&/^\d+(?:\.\d+)?px$/.test(v))out[k]=v;
      else if(['rr_scrollLeft','rr_scrollTop'].includes(k)&&typeof v==='number')out[k]=number(v);
      else if(v===null&&['class','_cssText','rr_width','rr_height'].includes(k))out[k]=null; // Attribute removal; no content.
    }
    return out;
  }
  function node(raw:unknown,depth=0):Obj|null{
    if(!record(raw)||depth>100||!Number.isInteger(raw.id))return null;
    const common={id:raw.id,type:raw.type};
    if(raw.type===0)return {...common,compatMode:raw.compatMode==='BackCompat'?'BackCompat':'CSS1Compat',childNodes:Array.isArray(raw.childNodes)?raw.childNodes.map(n=>node(n,depth+1)).filter(Boolean):[]};
    if(raw.type===1)return {...common,name:'html',publicId:'',systemId:''};
    if(raw.type===2)return {...common,tagName:tags.has(raw.tagName)?raw.tagName:'div',attributes:attributes(raw.attributes),childNodes:Array.isArray(raw.childNodes)?raw.childNodes.map(n=>node(n,depth+1)).filter(Boolean):[]};
    if(raw.type===3||raw.type===4)return {...common,textContent:mask(raw.textContent)};
    if(raw.type===5)return {...common,textContent:''};
    return null;
  }
  const numeric=(raw:Obj,keys:string[])=>Object.fromEntries(keys.filter(k=>typeof raw[k]==='number').map(k=>[k,number(raw[k])]));
  function snapshot(raw:unknown,href:string):Obj|null{
    if(!record(raw)||!record(raw.data)||!Number.isFinite(raw.timestamp))return null;
    const base={type:raw.type,timestamp:raw.timestamp},d=raw.data;
    if(raw.type===0||raw.type===1)return {...base,data:{}};
    if(raw.type===4)return {...base,data:{href,...numeric(d,['width','height'])}};
    if(raw.type===2){const n=node(d.node);return n?{...base,data:{node:n,initialOffset:record(d.initialOffset)?numeric(d.initialOffset,['top','left']):{top:0,left:0}}}:null;}
    if(raw.type!==3)return null;
    const data:Obj={source:d.source};
    if(d.source===0){
      data.texts=Array.isArray(d.texts)?d.texts.filter(record).map(v=>({id:number(v.id),value:mask(v.value)})):[];
      data.attributes=Array.isArray(d.attributes)?d.attributes.filter(record).map(v=>({id:number(v.id),attributes:attributes(v.attributes)})):[];
      data.removes=Array.isArray(d.removes)?d.removes.filter(record).map(v=>numeric(v,['parentId','id'])):[];
      data.adds=Array.isArray(d.adds)?d.adds.filter(record).map(v=>({...numeric(v,['parentId','nextId']),...(v.nextId===null?{nextId:null}:{}),node:node(v.node)})).filter(v=>v.node):[];
      if(typeof d.isAttachIframe==='boolean')data.isAttachIframe=d.isAttachIframe;
    } else if([1,6,12].includes(d.source))data.positions=Array.isArray(d.positions)?d.positions.filter(record).map(v=>numeric(v,['x','y','id','timeOffset'])):[];
    else if([2,3,4].includes(d.source))Object.assign(data,numeric(d,['type','id','x','y','width','height']));
    else if(d.source===5)Object.assign(data,{id:number(d.id),text:mask(d.text),isChecked:!!d.isChecked});
    else return null; // No network, console, canvas, CSS mutations, custom events, fonts or plugins.
    return {...base,data};
  }
  return {attribute,snapshot,mask};
}
