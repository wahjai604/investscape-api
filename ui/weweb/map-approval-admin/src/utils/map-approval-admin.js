/** Host supplies an authenticated client. No credential fields, token storage or default network client. */
export function createMapApprovalClient(authenticatedFetch) {
  if(typeof authenticatedFetch!=='function')throw Error('AUTHENTICATED_FETCH_REQUIRED');
  const send=async(path,options)=>{
    const response=await authenticatedFetch('/v1/market-intel/map/admin/'+path,
      {...options,credentials:'omit',headers:{Accept:'application/json',...(options?.headers||{})}});
    const body=await response.json();
    return response.ok?{ok:true,...(body.member?{member:body.member}:{revision:body.revision})}:
      {ok:false,code:body.error?.code||'MAP_STORE_UNAVAILABLE'};
  };
  return {inspect:subject=>send('member?subject='+encodeURIComponent(subject)),
    change:command=>send('changes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)})};
}
const documentCounters = new WeakMap();
export function mountMapApprovalAdmin(root, client = null) {
  const document = root.ownerDocument;
  const counter = (documentCounters.get(document) ?? 0) + 1;
  documentCounters.set(document, counter);
  const prefix = `mi-approval-${counter}-`;
  const uuid = () => document.defaultView.crypto.randomUUID();
  root.replaceChildren();
  const el = (tag, text, attrs = {}) => { const n=document.createElement(tag); if(text)n.textContent=text;
    for(const [key,value] of Object.entries(attrs))n.setAttribute(key,value);return n; };
  const panel=el('section',null,{'aria-labelledby':prefix+'title',class:'approval-panel'});
  panel.append(el('p','INVESTSCAPE · ACCESS ADMINISTRATION',{class:'eyebrow'}),el('h1','Manual member approval',{id:prefix+'title'}),
    el('p','Load a member’s current status before approving, renewing or revoking map access. Each change records your reason and the previous revision.',{class:'intro'}));
  const form=el('form'); const target=el('input',null,{id:prefix+'member',name:'subject',required:'',maxlength:'256',autocomplete:'off'});
  const load=el('button','Load membership',{type:'submit',class:'primary'});
  const label=el('label','Verified member reference',{for:prefix+'member'});
  form.append(label,target,el('p','Use the member reference supplied by the trusted account workflow.',{class:'hint'}),load);
  const status=el('p','Approval service is not connected.',{role:'status','aria-live':'polite',class:'status'});
  const review=el('section',null,{'aria-label':'Current membership',class:'review'});
  const summary=el('p','No membership loaded.');review.append(summary);
  const controls=el('div',null,{class:'controls'});
  const expiry=el('input',null,{id:prefix+'expiry',type:'datetime-local',required:''});
  const reason=el('textarea',null,{id:prefix+'reason',rows:'3',maxlength:'500',required:''});
  const approve=el('button','Approve member',{type:'button',class:'primary'});
  const revoke=el('button','Revoke access',{type:'button',class:'danger'});
  controls.append(el('label','Approval expiry (your local time)',{for:prefix+'expiry'}),expiry,
    el('label','Reason for this change',{for:prefix+'reason'}),reason);
  const actions=el('div',null,{class:'actions'});actions.append(approve,revoke);controls.append(actions);
  const audit=el('section',null,{'aria-label':'Recent approval audit',class:'audit'});
  audit.append(el('h2','Recent approval audit'));const auditList=el('ol');audit.append(auditList);
  panel.append(form,status,review,controls,audit);root.append(panel);
  let snapshot=null, busy=false, operation=0, destroyed=false;
  const connected=!!client&&typeof client.inspect==='function'&&typeof client.change==='function';
  const expirySeconds=()=>new Date(expiry.value).getTime()/1000;
  const setButtons=()=>{load.disabled=!connected||busy||!target.value.trim();
    const current=snapshot&&snapshot.subject===target.value.trim();
    approve.disabled=!connected||busy||!current||!reason.value.trim()||!Number.isFinite(expirySeconds())||expirySeconds()<=Date.now()/1000;
    revoke.disabled=!connected||busy||!current||snapshot.state==='no_grant'||snapshot.state==='revoked'||!reason.value.trim();};
  const clear=()=>{snapshot=null;summary.textContent='No membership loaded.';auditList.replaceChildren();setButtons();};
  const messageFor=code=>({ACCESS_DENIED:'Access administrator permission is required.',
    AUTHENTICATION_REQUIRED:'Sign in again before continuing.', APPROVAL_CHANGED:'Membership changed. Reload its status and audit before retrying.',
    ORIGIN_DENIED:'This approval interface has not been authorized for the API.',INVALID_APPROVAL:'Check the member reference, expiry and reason.'}[code]||'Approval service is unavailable.');
  const show=member=>{
    if(!member||member.subject!==target.value.trim()||!Number.isSafeInteger(member.revision)||
      !['no_grant','active','expired','revoked'].includes(member.state)||!Array.isArray(member.audit))throw Error('INVALID_MEMBER_RESPONSE');
    snapshot=member;
    summary.textContent=`Status: ${member.state.replace('_',' ')} · Revision ${member.revision}`+
      (member.expiresAt?` · Expires ${new Date(member.expiresAt*1000).toLocaleString()}`:'');
    approve.textContent=member.state==='active'?'Renew approval':'Approve member';
    auditList.replaceChildren();
    for(const event of member.audit.slice(0,20))auditList.append(el('li',
      `${event.action} · Revision ${event.beforeRevision} → ${event.afterRevision} · ${new Date(event.occurredAt).toLocaleString()} — ${event.reason}`));
    if(!member.audit.length)auditList.append(el('li','No approval events recorded.'));
  };
  async function inspect(event){event?.preventDefault();if(!connected||busy||!target.value.trim())return;
    const version=++operation, subject=target.value.trim();busy=true;clear();status.textContent='Loading membership and audit…';setButtons();
    try{const result=await client.inspect(subject);if(destroyed||version!==operation||subject!==target.value.trim())return;
      if(!result.ok){status.textContent=messageFor(result.code);return;}show(result.member);status.textContent='Review the current status and enter a reason for your decision.';
    }catch{if(!destroyed&&version===operation)status.textContent='Membership could not be loaded. Retry when the service is available.';}
    finally{if(!destroyed&&version===operation){busy=false;setButtons();}}
  }
  async function change(action){
    if((action==='approve'?approve:revoke).disabled)return;
    const version=++operation, subject=target.value.trim(), expectedRevision=snapshot.revision;
    const command={subject,action,expectedRevision,requestId:uuid(),reason:reason.value.trim(),
      ...(action==='approve'?{expiresAt:expirySeconds()}:{})};
    busy=true;status.textContent='Saving your decision…';setButtons();
    try{
      const result=await client.change(command);
      if(destroyed||version!==operation||subject!==target.value.trim())return;
      clear();
      if(!result.ok){status.textContent=messageFor(result.code)+' Reload membership before another change.';return;}
      // Treat the write receipt as provisional: render only freshly reloaded persisted state.
      status.textContent='Reloading membership and audit…';
      const fresh=await client.inspect(subject);
      if(destroyed||version!==operation||subject!==target.value.trim())return;
      if(!fresh.ok||fresh.member.revision<result.revision)throw Error('RECONCILIATION_REQUIRED');
      show(fresh.member);reason.value='';
      status.textContent=`Decision recorded. Current persisted revision: ${fresh.member.revision}.`;
    }catch{if(!destroyed&&version===operation){clear();status.textContent='Result uncertain. Reload membership and audit before retrying.';}}
    finally{if(!destroyed&&version===operation){busy=false;setButtons();}}
  }
  form.addEventListener('submit',inspect);
  target.addEventListener('input',()=>{++operation;busy=false;clear();status.textContent=connected?'Load this member’s current status.':'Approval service is not connected.';});
  reason.addEventListener('input',setButtons);expiry.addEventListener('input',setButtons);
  approve.addEventListener('click',()=>change('approve'));revoke.addEventListener('click',()=>change('revoke'));
  if(connected)status.textContent='Load a member to begin.';
  setButtons();
  return {destroy(){destroyed=true;++operation;root.replaceChildren();}};
}
