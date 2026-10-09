import {createMapSessionTransport} from './map-session-adapter.js';
import {createMapApprovalClient,mountMapApprovalAdmin} from './map-approval-admin.js';
/** Lifecycle shared by the actual Vue wrapper and synthetic tests. No provider lookup or default session. */
export function mountMapApprovalHost(root,{enabled=false,editing=false,apiOrigin='',host=null,fetchImpl=null}={}){
  let transport=null,view=null,destroyed=false;
  const render=client=>{if(destroyed)return;view?.destroy();view=mountMapApprovalAdmin(root,client);};
  if(enabled===true&&editing===false){
    try{
      transport=createMapSessionTransport({apiOrigin,host,fetchImpl,onInvalidate:()=>render(createMapApprovalClient(transport.authenticatedFetch))});
    }catch{/* Invalid/unbound host stays visibly disconnected. */}
  }
  render(transport?createMapApprovalClient(transport.authenticatedFetch):null);
  return {destroy(){if(destroyed)return;destroyed=true;transport?.dispose();view?.destroy();}};
}
