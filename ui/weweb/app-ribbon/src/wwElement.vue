<template>
  <div class="app-ribbon" :data-theme="theme" :lang="locale">
    <div class="brand"><strong>InvestScape</strong><span>{{ t('preview') }}</span></div>
    <nav :aria-label="t('modules')" class="main-ribbon">
      <button v-for="module in mainModules" :key="module" type="button" :disabled="isEditing"
        :aria-pressed="mainModule === module" :class="{selected: mainModule === module}"
        @click="choose(module === 'development' ? developmentModule : module)">{{ t(module) }}</button>
    </nav>
    <nav v-if="mainModule === 'development'" :aria-label="t('developmentTools')" class="sub-ribbon">
      <button v-for="module in ['quick','full']" :key="module" type="button" :disabled="isEditing"
        :aria-pressed="activeModule === module" :class="{selected: activeModule === module}"
        @click="choose(module)">{{ t(module) }}</button>
    </nav>
    <p v-else-if="mainModule === 'library'" class="sub-hint">{{ t('libraryHint') }}</p>
    <p v-else-if="mainModule === 'market-intel'" class="sub-hint">{{ t('mapHint') }}</p>
  </div>
</template>
<script setup>
import {computed,ref} from 'vue';
import {labels} from './utils/labels.js';
const props=defineProps({uid:{type:String,required:true},content:{type:Object,required:true},
  /* wwEditor:start */
  wwEditorState:{type:Object,required:true},
  /* wwEditor:end */
});
const emit=defineEmits(['trigger-event']);
const isEditing=computed(()=>{
  /* wwEditor:start */
  return props.wwEditorState?.isEditing===true;
  /* wwEditor:end */
  // eslint-disable-next-line no-unreachable
  return false;
});
const mainModules=['workspace','development','portfolio','market-intel','research','library','community'];
const allowedModules=['workspace','quick','full','portfolio','market-intel','research','library','community'];
const locale=computed(()=>['en','fr-CA','zh-Hant','zh-Hans'].includes(props.content?.locale)?props.content?.locale:'en');
const theme=computed(()=>props.content?.theme==='dark'?'dark':'light');
const activeModule=computed(()=>allowedModules.includes(props.content?.activeModule)?props.content?.activeModule:'library');
const lastDevelopment=ref('quick');
const developmentModule=computed(()=>['quick','full'].includes(activeModule.value)?activeModule.value:lastDevelopment.value);
const mainModule=computed(()=>['quick','full'].includes(activeModule.value)?'development':activeModule.value);
const t=key=>labels[key]?.[locale.value]??labels[key]?.en??key;
function choose(value){
  if(isEditing.value||!allowedModules.includes(value)||value===activeModule.value)return;
  if(['quick','full'].includes(value))lastDevelopment.value=value;
  // The host changes an internal panel only. No router, history or URL updates.
  emit('trigger-event',{name:'moduleChange',event:{value}});
}
</script>
<style scoped>
.app-ribbon{--canvas:var(--58680c68-e2cd-4ff9-bd05-3c5357f142eb,#ece4d3);--surface:var(--b8e9b391-71ce-4310-9442-0961b32b4489,#faf6ed);--text:var(--a7a3194c-5a7f-4a26-a014-0306d2f49eae,#14161c);--accent:var(--16f1c48a-4cfd-4201-a01f-1a876dd5c03d,#8a6212);--border:var(--b0479118-3ec8-4ae5-8a4b-8be2bbb6ab47,#767064);color:var(--text);background:var(--canvas);font:inherit;line-height:1.5;overflow-wrap:anywhere}
.app-ribbon[data-theme=dark]{--canvas:#0e1117;--surface:#171b26;--text:#eef0f4;--accent:#d9b04a;--border:#7d8798}*{box-sizing:border-box}.brand{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px}.brand strong{font-size:1.5rem}.brand span{border:1px solid var(--border);border-radius:24px;padding:4px 10px;font-size:.8125rem}.main-ribbon,.sub-ribbon{display:flex;flex-wrap:wrap;gap:8px}.sub-ribbon{margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}button{font:inherit;min-height:44px;max-width:100%;white-space:normal;padding:10px 14px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);cursor:pointer;transition:box-shadow .18s ease,transform .18s ease}button:hover:not(:disabled){box-shadow:inset 0 0 0 1px var(--accent);transform:translateY(-1px)}button.selected{box-shadow:inset 0 -3px var(--accent);font-weight:700}button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button:disabled{cursor:default}.sub-hint{margin:12px 0 0;font-size:.875rem}
</style>
