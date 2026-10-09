<template>
  <section class="research-library" aria-label="Research library">
    <h2>{{ content?.heading || 'Research' }}</h2>
    <p>Curated research with source attribution and reviewed summaries or links.</p>
    <form @submit.prevent="load(0)" class="research-filters">
      <label>Search title or publisher<input v-model="q" type="search" maxlength="120" :disabled="isEditing || !enabled" /></label>
      <label>Geography reference<input v-model="geography" maxlength="120" :disabled="isEditing || !enabled" placeholder="For example, CA-CMA-933" /></label>
      <label>Topic<input v-model="topic" maxlength="120" :disabled="isEditing || !enabled" /></label>
      <button type="submit" :disabled="isEditing || !enabled">Search / refresh</button>
    </form>
    <p role="status" aria-live="polite">{{ statusText }}</p>
    <ul v-if="state.items.length" class="research-results">
      <li v-for="record in state.items" :key="record.id">
        <button type="button" @click="select(record.id)" :disabled="isEditing">{{ record.title }}</button>
        <p>{{ record.publisher }} · {{ record.geography.join(', ') }}</p>
        <p>Published: {{ displayDate(record.publishedAt) }} · Reviewed: {{ displayDate(record.reviewedAt) }}</p>
        <span>{{ record.contentMode === 'link_only' ? 'Source link' : 'Reviewed summary' }}</span>
      </li>
    </ul>
    <nav v-if="state.pagination" aria-label="Research result pages">
      <button type="button" @click="load(Math.max(0, state.pagination.offset - 25))" :disabled="isEditing || state.pagination.offset === 0">Previous</button>
      <button type="button" @click="load(state.pagination.offset + 25)" :disabled="isEditing || !state.pagination.hasMore">Next</button>
    </nav>
    <article v-if="state.selected" class="research-detail" aria-label="Selected research">
      <h3>{{ state.selected.title }}</h3>
      <p>{{ state.selected.publisher }} · {{ state.selected.topics.join(', ') }}</p>
      <p v-if="state.selected.summary">{{ state.selected.summary }}</p>
      <p v-else>This item provides a source link. A summary is not available under its recorded permissions.</p>
      <p>{{ state.selected.attribution }}</p>
      <p>Published: {{ displayDate(state.selected.publishedAt) }} · Retrieved: {{ displayDate(state.selected.retrievedAt) }}</p>
      <p>Reviewed: {{ displayDate(state.selected.reviewedAt) }} · Review due: {{ displayDate(state.selected.reviewDueAt) }}</p>
      <a :href="state.selected.canonicalUrl" target="_blank" rel="noopener noreferrer">Open original source (new tab)</a>
    </article>
  </section>
</template>
<script>
import {computed,ref,onBeforeUnmount,watch} from 'vue';
import {createResearchLibrary} from './utils/research-library.js';
import {createResearchSessionTransport,RESEARCH_SESSION_HOST_KEY} from './utils/research-session-adapter.js';
export default {
  props:{uid:{type:String,required:true},content:{type:Object,required:true},
    /* wwEditor:start */
    wwEditorState:{type:Object,required:true},
    /* wwEditor:end */
  },
  setup(props){
    const isEditing=computed(()=>{
      /* wwEditor:start */
      return props.wwEditorState?.isEditing===true;
      /* wwEditor:end */
      return false;
    });
    const enabled=computed(()=>props.content?.enabled===true),q=ref(''),geography=ref(''),topic=ref('');
    const state=ref({status:'idle',items:[],selected:null,revision:null,pagination:null});
    let library,transport,frontDocument;
    const stop=()=>{transport?.dispose();library?.dispose();transport=null;library=null;
      frontDocument?.removeEventListener('visibilitychange',visibility);frontDocument=null;};
    const visibility=()=>{if(frontDocument?.hidden)transport?.invalidate();};
    function connect(){
      if(library)return true;
      try{
        const frontWindow=wwLib.getFrontWindow();frontDocument=wwLib.getFrontDocument();
        const host=frontWindow[RESEARCH_SESSION_HOST_KEY];
        transport=createResearchSessionTransport({apiOrigin:props.content?.apiOrigin,host,
          fetchImpl:frontWindow.fetch.bind(frontWindow),onInvalidate:()=>library?.clear('refresh_required')});
        library=createResearchLibrary({request:transport.authenticatedFetch,onState:value=>{state.value=value;}});
        frontDocument.addEventListener('visibilitychange',visibility);return true;
      }catch{stop();state.value={status:'unavailable',items:[],selected:null,revision:null,pagination:null};return false;}
    }
    async function load(offset=0){if(isEditing.value||!enabled.value)return;
      if(connect())await library.load({q:q.value,geography:geography.value,topic:topic.value,offset,limit:25});}
    async function select(id){if(isEditing.value||!enabled.value)return;if(connect())await library.select(id);}
    watch(()=>[props.content?.enabled,props.content?.apiOrigin,isEditing.value],()=>{stop();state.value={status:'idle',items:[],selected:null,revision:null,pagination:null};});
    onBeforeUnmount(stop);
    const statusText=computed(()=>{
      if(!enabled.value)return 'Research browsing is not available yet.';
      return {idle:'Sign in, then search to browse approved research.',loading:'Loading research…',loading_detail:'Loading selected research…',
        ready:'Approved research is available.',empty:'No approved research matches these filters.',
        refresh_required:'Refresh to check current access and publication status.',unavailable:'Research is unavailable. Check your sign-in and try again.'}[state.value.status];
    });
    const displayDate=value=>value?new Date(value).toLocaleDateString('en-CA'):'Not supplied';
    return {isEditing,enabled,state,q,geography,topic,load,select,statusText,displayDate};
  },
};
</script>
<style scoped>
.research-library {width:100%;min-width:0;color:var(--research-text,inherit);background:var(--research-canvas,transparent);font:inherit;overflow-wrap:anywhere;}
.research-filters {display:flex;flex-wrap:wrap;align-items:end;gap:1rem;}
label {display:grid;gap:.4rem;flex:1 1 12rem;min-width:0;}
input,button {font:inherit;color:inherit;background:var(--research-control,transparent);border:1px solid currentColor;border-radius:.35rem;padding:.65rem;}
input {min-width:0;width:100%;box-sizing:border-box;}
button {cursor:pointer;}button:disabled {cursor:default;opacity:.6;}
button:focus-visible,input:focus-visible,a:focus-visible {outline:3px solid currentColor;outline-offset:3px;}
.research-results {list-style:none;padding:0;display:grid;gap:1rem;}
.research-results li,.research-detail {border:1px solid currentColor;border-radius:.5rem;padding:1rem;}
.research-results button {text-align:left;}a {color:inherit;}nav {display:flex;gap:.75rem;flex-wrap:wrap;}
</style>
