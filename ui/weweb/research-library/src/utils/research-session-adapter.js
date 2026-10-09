/** Bounded transport for an explicitly supplied existing Auth host. Never discovers a provider or stores tokens. */
const unavailable=()=>new Error('RESEARCH_REQUEST_UNAVAILABLE');
const required=()=>new Error('AUTHENTICATION_REQUIRED');
const changed=()=>new Error('SESSION_CHANGED');
const invalid=()=>new Error('INVALID_RESEARCH_REQUEST');
export const RESEARCH_SESSION_HOST_KEY=Symbol.for('investscape.research.session-host.v1');
export function registerResearchSessionHost(frontWindow,host){
  if(!frontWindow||!host||frontWindow[RESEARCH_SESSION_HOST_KEY])throw Error('RESEARCH_HOST_UNAVAILABLE');
  frontWindow[RESEARCH_SESSION_HOST_KEY]=host;
  let removed=false;
  return()=>{if(!removed){removed=true;if(frontWindow[RESEARCH_SESSION_HOST_KEY]===host)delete frontWindow[RESEARCH_SESSION_HOST_KEY];}};
}
function origin(value){
  try{const u=new URL(value);if(typeof value==='string'&&u.protocol==='https:'&&u.origin===value)return value;}catch{}
  throw unavailable();
}
function selection(path,options){
  if(typeof path!=='string'||path.length>2048||!path.startsWith('/v1/research/')||path.includes('#'))throw invalid();
  const url=new URL(path,'https://selection.invalid'),method=options?.method??'GET';
  if(Object.keys(options??{}).some(k=>!['method','body','headers','credentials'].includes(k))||
    (options?.credentials!==undefined&&options.credentials!=='omit'))throw invalid();
  const headers=new Headers(options?.headers);
  for(const key of headers.keys())if(!['accept','content-type'].includes(key))throw invalid();
  const qs=url.searchParams,unique=(key)=>qs.getAll(key).length===1;
  const only=(keys)=>[...qs.keys()].every(k=>keys.includes(k));
  let allowed=false;
  if(url.pathname==='/v1/research/items')allowed=method==='GET'&&only(['q','geography','topic','offset','limit'])&&
    [...qs.keys()].every(k=>unique(k))&&[...qs.values()].every(v=>v.length<=120)&&
    (!qs.has('offset')||/^(0|[1-9][0-9]{0,4})$/.test(qs.get('offset')))&&
    (!qs.has('limit')||(/^[1-9][0-9]?$/.test(qs.get('limit'))&&Number(qs.get('limit'))<=50));
  else if(/^\/v1\/research\/items\/[a-z][a-z0-9-]{0,79}$/.test(url.pathname))
    allowed=method==='GET'&&[...qs.keys()].length===0;
  // Disallow URL normalization, fragments, encoded path segments, GET bodies and proxy URL escape tricks.
  if(!allowed||url.origin!=='https://selection.invalid'||path.split('?')[0]!==url.pathname||
    (method==='GET'&&options?.body!==undefined))throw invalid();
  return {path:url.pathname+url.search,method,body:options?.body};
}
function validatedSession(value,issuer){
  if(!value||value.issuer!==issuer||typeof value.subject!=='string'||!value.subject||value.subject.length>256||
    typeof value.expiresAt!=='number'||!Number.isFinite(value.expiresAt)||value.expiresAt<=Date.now()/1000||
    typeof value.accessToken!=='string'||value.accessToken.length>16384||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.accessToken))throw required();
  return {issuer:value.issuer,subject:value.subject,expiresAt:value.expiresAt,accessToken:value.accessToken};
}
/** Every invalidation cancels pending requests and clears the host UI; it is not a server authorization grant. */
export function createResearchSessionTransport({apiOrigin,host,fetchImpl,timeoutMs=10000,onInvalidate=()=>{}}){
  const base=origin(apiOrigin);
  if(!host||typeof host.readSession!=='function'||typeof host.subscribe!=='function'||typeof fetchImpl!=='function'||
    !/^https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1$/.test(host.issuer)||
    !Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000||typeof onInvalidate!=='function')throw unavailable();
  const issuer=host.issuer;
  let epoch=0,disposed=false,expiryTimer;const pending=new Set();
  const invalidate=()=>{if(disposed)return;clearTimeout(expiryTimer);epoch++;for(const c of pending)c.abort();
    try{onInvalidate();}catch{/* Host UI errors never expose session diagnostics. */}};
  let unsubscribe;
  try{unsubscribe=host.subscribe(invalidate);if(typeof unsubscribe!=='function')throw unavailable();}catch{throw unavailable();}
  async function authenticatedFetch(path,options={}){
    if(disposed)throw unavailable();
    const request=selection(path,options),version=epoch,controller=new AbortController();pending.add(controller);
    let timer;const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(unavailable()),{once:true}));
    const bounded=promise=>Promise.race([promise,aborted]);
    timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const session=validatedSession(await bounded(Promise.resolve().then(()=>host.readSession())),issuer);
      clearTimeout(expiryTimer);expiryTimer=setTimeout(invalidate,Math.max(0,session.expiresAt*1000-Date.now()));
      if(disposed||version!==epoch)throw changed();
      const headers={Accept:'application/json',Authorization:'Bearer '+session.accessToken,
        ...(request.method==='POST'?{'Content-Type':'application/json'}:{})};
      const response=await bounded(Promise.resolve().then(()=>fetchImpl(base+request.path,{
        method:request.method,body:request.body,headers,credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal})));
      if(response.redirected||!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw unavailable();
      if(Number(response.headers.get('content-length'))>1048576)throw unavailable();
      // Buffer within the deadline and size bound before the final account observation.
      let bytes=0;const chunks=[],reader=response.body?.getReader();
      if(!reader)throw unavailable();
      try{for(;;){const part=await bounded(reader.read());if(part.done)break;bytes+=part.value.byteLength;
        if(bytes>1048576)throw unavailable();chunks.push(part.value);}}
      finally{reader.cancel().catch(()=>{});reader.releaseLock();}
      const merged=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.length;}
      const json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(merged));
      const current=validatedSession(await bounded(Promise.resolve().then(()=>host.readSession())),issuer);
      if(disposed||version!==epoch||current.issuer!==session.issuer||current.subject!==session.subject){invalidate();throw changed();}
      return new Response(JSON.stringify(json),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    }catch(error){
      controller.abort();
      if(disposed||version!==epoch)throw changed();
      if(error?.message==='AUTHENTICATION_REQUIRED')throw required();
      if(error?.message==='SESSION_CHANGED')throw changed();
      throw unavailable();
    }finally{clearTimeout(timer);pending.delete(controller);}
  }
  return {authenticatedFetch,invalidate,dispose(){if(disposed)return;disposed=true;epoch++;
    clearTimeout(expiryTimer);for(const c of pending)c.abort();pending.clear();try{unsubscribe();}catch{} }};
}
