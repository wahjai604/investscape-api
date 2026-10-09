const invalid=()=>new Error('RESEARCH_UNAVAILABLE');
const id=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(value);
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;
function item(value){
  if(!value||!id(value.id)||!Number.isSafeInteger(value.revision)||value.revision<1||
    !text(value.title,240)||!text(value.publisher,160)||!text(value.attribution,1000)||
    !['summary','link_only'].includes(value.contentMode)||
    (value.contentMode==='link_only'&&value.summary!==null)||
    (value.contentMode==='summary'&&!text(value.summary,4000))||
    value.permissionMetadata?.audience!=='member'||value.permissionMetadata?.fullTextAllowed!==false||
    typeof value.permissionMetadata?.aiAllowed!=='boolean'||!date(value.reviewedAt)||!date(value.reviewDueAt)||
    !date(value.readValidUntil)||Date.parse(value.readValidUntil)<=Date.now()||
    ![value.publishedAt,value.retrievedAt].every(v=>v===null||date(v))||
    ![value.geography,value.topics].every(a=>Array.isArray(a)&&a.length>0&&a.length<=16&&a.every(v=>text(v,80))))throw invalid();
  let url;try{url=new URL(value.canonicalUrl);}catch{throw invalid();}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||value.canonicalUrl.length>2048)throw invalid();
  // Explicit projection, never render HTML/article bodies or arbitrary server fields.
  return {id:value.id,revision:value.revision,title:value.title,publisher:value.publisher,canonicalUrl:url.href,
    attribution:value.attribution,contentMode:value.contentMode,summary:value.summary,geography:[...value.geography],
    topics:[...value.topics],publishedAt:value.publishedAt,retrievedAt:value.retrievedAt,reviewedAt:value.reviewedAt,
    reviewDueAt:value.reviewDueAt,readValidUntil:value.readValidUntil};
}
/** All visible records are short-lived snapshots. No localStorage, article ingestion or AI side channel. */
export function createResearchLibrary({request,onState=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
  if(typeof request!=='function')throw invalid();
  let generation=0,disposed=false,timer;
  let state={status:'idle',items:[],selected:null,revision:null,pagination:null};
  const emit=()=>onState({...state,items:[...state.items]});
  const clear=(status='idle')=>{generation++;clearTimer(timer);state={status,items:[],selected:null,revision:null,pagination:null};emit();};
  function schedule(){
    clearTimer(timer);const records=[...state.items,...(state.selected?[state.selected]:[])];
    if(records.length){const expires=Math.min(Date.now()+30000,...records.map(v=>Date.parse(v.readValidUntil)));
      timer=setTimer(()=>clear('refresh_required'),Math.max(0,expires-Date.now()));}
  }
  async function load(filters={}){
    if(disposed)return;clear('loading');const version=generation;
    try{
      if(Object.keys(filters).some(k=>!['q','geography','topic','offset','limit'].includes(k)))throw invalid();
      const params=new URLSearchParams();for(const [key,value]of Object.entries(filters)){
        if(value!==''&&value!==undefined&&value!==null)params.set(key,String(value));}
      const response=await request('/v1/research/items'+(params.size?'?'+params:''));
      if(!response.ok)throw invalid();const data=await response.json();
      if(disposed||generation!==version)return;
      if(!Number.isSafeInteger(data.revision)||data.revision<0||!Array.isArray(data.items)||data.items.length>50||
        !['available','no_data'].includes(data.coverage?.status)||!data.pagination||
        !Number.isSafeInteger(data.pagination.offset)||!Number.isSafeInteger(data.pagination.limit)||
        data.pagination.offset<0||data.pagination.limit<1||data.pagination.limit>50||
        typeof data.pagination.hasMore!=='boolean')throw invalid();
      const items=data.items.map(item);if(new Set(items.map(i=>i.id)).size!==items.length)throw invalid();
      state={status:items.length?'ready':'empty',items,selected:null,revision:data.revision,pagination:{...data.pagination}};
      schedule();emit();
    }catch{if(!disposed&&generation===version)clear('unavailable');}
  }
  async function select(itemId){
    if(disposed)return;
    const version=++generation;state={...state,selected:null,status:'loading_detail'};emit();
    try{
      if(!id(itemId))throw invalid();const response=await request('/v1/research/items/'+itemId);
      if(!response.ok)throw invalid();const data=await response.json();
      if(disposed||generation!==version)return;
      if(!Number.isSafeInteger(data.revision)||data.revision<0||data.item?.id!==itemId)throw invalid();
      const selected=item(data.item);
      if(state.revision!==data.revision)state={...state,items:[],pagination:null};
      state={...state,status:'ready',selected,revision:data.revision};schedule();emit();
    }catch{if(!disposed&&generation===version)clear('unavailable');}
  }
  return {load,select,clear,dispose(){if(disposed)return;disposed=true;clear('idle');}};
}
