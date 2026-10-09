/** Source-only bridge for an explicitly verified, existing public Supabase client.
 * No provider discovery, client creation, cached _session, token decoding or storage.
 * The configured issuer is an expectation; only the API verifies the signed issuer.
 */
const unavailable=()=>new Error('MAP_HOST_UNAVAILABLE');
const required=()=>new Error('AUTHENTICATION_REQUIRED');
const changed=()=>new Error('SESSION_CHANGED');
export function createExistingSupabaseMapHost({client,issuer,getCurrentClient}={}){
  if(typeof issuer!=='string'||!/^https:\/\/[a-z0-9]+\.supabase\.co\/auth\/v1$/.test(issuer)||
    typeof getCurrentClient!=='function'||typeof client?.auth?.getSession!=='function'||
    typeof client?.auth?.onAuthStateChange!=='function')throw unavailable();
  let disposed=false,replaced=false,epoch=0,timer=null,stop=null;
  const listeners=new Set();
  const notify=()=>{for(const listener of [...listeners]){if(listeners.has(listener))try{listener();}catch{}}};
  const queue=()=>{
    if(disposed||timer!==null||listeners.size===0)return;
    timer=setTimeout(()=>{timer=null;if(!disposed)notify();},0);
  };
  const cancel=()=>{if(timer!==null){clearTimeout(timer);timer=null;}};
  const stopSubscription=()=>{const close=stop;stop=null;if(close)try{close();}catch{}};
  const ensureCurrent=()=>{
    if(disposed)throw unavailable();
    let same=false;try{same=getCurrentClient()===client;}catch{}
    if(!same&&!replaced){replaced=true;epoch++;queue();}
    if(replaced)throw changed();
  };
  ensureCurrent();
  const host={
    issuer,
    async readSession(){
      ensureCurrent();const generation=epoch;
      let result;try{result=await client.auth.getSession();}catch{throw required();}
      ensureCurrent();if(generation!==epoch)throw changed();
      const session=result?.data?.session;
      if(result?.error||!session||session.user?.is_anonymous!==false||
        typeof session.user?.id!=='string'||!session.user.id||session.user.id.length>256||
        typeof session.expires_at!=='number'||!Number.isFinite(session.expires_at)||
        session.expires_at<=Date.now()/1000||typeof session.access_token!=='string'||
        session.access_token.length>16384||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(session.access_token))throw required();
      return {issuer,subject:session.user.id,expiresAt:session.expires_at,accessToken:session.access_token};
    },
    subscribe(listener){
      ensureCurrent();if(typeof listener!=='function')throw unavailable();
      // Each subscription owns its own entry, even if the caller reuses a callback.
      const entry=()=>listener();listeners.add(entry);
      if(!stop){
        try{
          const result=client.auth.onAuthStateChange(()=>{
            // Synchronous fence; listeners run later, outside the SDK Auth lock.
            if(disposed)return;epoch++;
            try{ensureCurrent();}catch{}
            queue();
          });
          const subscription=result?.data?.subscription;
          if(typeof subscription?.unsubscribe!=='function')throw unavailable();
          stop=()=>subscription.unsubscribe();
        }catch{
          listeners.delete(entry);if(listeners.size===0)cancel();throw unavailable();
        }
      }
      let removed=false;
      return ()=>{
        if(removed)return;removed=true;listeners.delete(entry);
        if(listeners.size===0){cancel();stopSubscription();}
      };
    },
    destroy(){
      if(disposed)return;disposed=true;epoch++;cancel();
      // Teardown is outside the SDK callback and clears/cancels current consumers.
      notify();listeners.clear();stopSubscription();
    }
  };
  return Object.freeze(host);
}
