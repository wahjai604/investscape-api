<template><div class="mi-map-approval-shell"><div ref="root"></div></div></template>
<script>
import {computed,onMounted,onBeforeUnmount,ref,watch} from 'vue';
import {mountMapApprovalHost} from './utils/map-approval-host.js';
import {MAP_SESSION_HOST_KEY} from './utils/map-session-adapter.js';
import './approval.css';
export default {
  props:{uid:{type:String,required:true},content:{type:Object,required:true},
    /* wwEditor:start */
    wwEditorState:{type:Object,required:true},
    /* wwEditor:end */
  },
  setup(props){
    const root=ref(null);
    const isEditing=computed(()=>{
      /* wwEditor:start */
      return props.wwEditorState?.isEditing===true;
      /* wwEditor:end */
      // eslint-disable-next-line no-unreachable
      return false;
    });
    let mounted=false,controller=null;
    const rebuild=()=>{
      controller?.destroy();controller=null;if(!mounted||!root.value)return;
      let host=null,fetchImpl=null;
      if(!isEditing.value&&props.content?.enabled===true){
        try{const frontWindow=wwLib.getFrontWindow();host=frontWindow[MAP_SESSION_HOST_KEY];fetchImpl=frontWindow.fetch.bind(frontWindow);}catch{}
      }
      controller=mountMapApprovalHost(root.value,{enabled:props.content?.enabled===true,editing:isEditing.value,
        apiOrigin:props.content?.apiOrigin??'',host,fetchImpl});
    };
    onMounted(()=>{mounted=true;rebuild();});
    watch(()=>[props.content?.enabled,props.content?.apiOrigin,isEditing.value],rebuild);
    onBeforeUnmount(()=>{mounted=false;controller?.destroy();controller=null;});
    return {root,isEditing};
  }
};
</script>
