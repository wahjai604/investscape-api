<template>
  <section class="learning-library" :data-theme="theme" :lang="language" :aria-label="t(labels.title)">
    <header class="library-heading">
      <div><p class="eyebrow">InvestScape</p><h2>{{ t(labels.title) }}</h2><p>{{ t(labels.intro) }}</p><p class="tag-legend">{{ t(labels.propertyTags) }}</p></div>
      <label class="language">{{ t(labels.language) }}
        <select :value="language" :disabled="isEditing" @change="setLanguage($event.target.value)">
          <option value="en">English</option><option value="fr-CA">Français</option>
          <option value="zh-Hant">繁體中文</option><option value="zh-Hans">简体中文</option>
        </select>
      </label>
    </header>
    <p v-if="!available" role="status">{{ t(labels.pending) }}</p>
    <template v-else>
      <label class="search">{{ t(labels.search) }}
        <input v-model="query" type="search" maxlength="200" :disabled="isEditing" :placeholder="t(labels.search)" />
      </label>
      <nav class="categories" :aria-label="t(labels.category)">
        <button v-for="key in ['all', ...categories]" :key="key" type="button" :aria-pressed="category === key" :disabled="isEditing" @click="setCategory(key)">{{ t(labels[key]) }}</button>
      </nav>
      <p class="result-count" role="status" aria-live="polite">{{ results.length }} {{ t(labels.count) }}</p>
      <div class="cards">
        <button v-for="item in results" :key="item.id" type="button" class="formula-card" :disabled="isEditing" aria-haspopup="dialog" @click="open(item, $event)">
          <span class="card-id">{{ item.id }} · {{ t(labels[item.category]) }}</span>
          <strong>{{ t(item.name) }}</strong><code>{{ item.formula }}</code>
          <span class="tags"><span v-for="tier in item.tiers" :key="tier">{{ tier }}</span></span>
        </button>
      </div>
      <div v-if="!results.length" class="empty"><p>{{ t(labels.empty) }}</p><button type="button" :disabled="isEditing" @click="clear">{{ t(labels.clear) }}</button></div>
      <p class="library-footer">{{ t(labels.footer) }}</p>
    </template>
    <div v-if="selected && available" class="backdrop" @click.self="close">
      <section ref="dialog" class="detail" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1" @keydown="dialogKeys">
        <div class="detail-header"><p class="eyebrow">{{ selected.id }} · {{ t(labels[selected.category]) }}</p>
          <button type="button" @click="close">{{ t(labels.close) }}</button></div>
        <h2 :id="titleId">{{ t(selected.name) }}</h2>
        <div class="tags"><span v-for="tier in selected.tiers" :key="tier">{{ tier }}</span></div>
        <code class="notation">{{ selected.formula }}</code>
        <h3>{{ t(labels.explanation) }}</h3><p>{{ t(selected.explanation) }}</p>
        <h3>{{ t(labels.example) }}</h3><p>{{ t(selected.example) }}</p><code>{{ selected.exampleFormula }}</code>
        <h3>{{ t(labels.scope) }}</h3><p>{{ t(selected.scope) }}</p>
        <template v-if="relatedEntries.length">
          <h3>{{ t(labels.related) }}</h3>
          <div class="tags"><button v-for="item in relatedEntries" :key="item.id" type="button" :disabled="isEditing" @click="openRelated(item)">{{ item.id }} · {{ t(item.name) }}</button></div>
        </template>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch, onBeforeUnmount } from 'vue';
import { catalog, categories, labels, normalizeLocale, translate, filterCatalog } from './utils/catalog.js';
const props = defineProps({
  uid: { type: String, required: true },
  content: { type: Object, required: true },
  /* wwEditor:start */
  wwEditorState: { type: Object, required: true },
  /* wwEditor:end */
});
const emit = defineEmits(['trigger-event']);
const isEditing = computed(() => {
  /* wwEditor:start */
  return props.wwEditorState?.isEditing === true;
  /* wwEditor:end */
  // eslint-disable-next-line no-unreachable
  return false;
});
const available = computed(() => props.content?.enabled === true);
const theme = computed(() => ['light','dark'].includes(props.content?.theme) ? props.content?.theme : 'auto');
const overrideLocale = ref(null), query = ref(''), category = ref('all'), selected = ref(null), dialog = ref(null);
const language = computed(() => normalizeLocale(overrideLocale.value ?? props.content?.locale));
const titleId = computed(() => 'library-detail-' + String(props.uid).replace(/[^a-zA-Z0-9_-]/g,''));
const t = value => translate(value, language.value);
const results = computed(() => filterCatalog(query.value, category.value, language.value));
const relatedEntries = computed(() => (selected.value?.relatedIds ?? []).map(id => catalog.find(item => item.id === id)).filter(Boolean));
let opener = null, focusSequence = 0, destroyed = false;
function setLanguage(value) {
  if (isEditing.value) return;
  const locale = normalizeLocale(value);
  if (locale === language.value) return;
  overrideLocale.value = locale;
  emit('trigger-event', { name: 'localeChange', event: { value: locale } });
}
function setCategory(value) { if (!isEditing.value) category.value = value; }
function clear() { if (!isEditing.value) { query.value = ''; category.value = 'all'; } }
function open(item, event) {
  if (!available.value || isEditing.value) return;
  opener = event.currentTarget; selected.value = item;
  const sequence = ++focusSequence;
  nextTick(() => { if (!destroyed && sequence === focusSequence) dialog.value?.focus(); });
}
function close() {
  selected.value = null;
  const target = opener; opener = null; const sequence = ++focusSequence;
  nextTick(() => { if (!destroyed && sequence === focusSequence && target?.isConnected && !target.disabled) target.focus(); });
}
function openRelated(item) {
  if (!available.value || isEditing.value) return;
  selected.value = item;
  const sequence = ++focusSequence;
  nextTick(() => { if (!destroyed && sequence === focusSequence) dialog.value?.focus(); });
}
function dialogKeys(event) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
  if (event.key !== 'Tab') return;
  const nodes = [...(dialog.value?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? [])];
  if (!nodes.length) { event.preventDefault(); dialog.value?.focus(); return; }
  const active = wwLib.getFrontDocument().activeElement, first = nodes[0], last = nodes[nodes.length-1];
  if (event.shiftKey && (active === first || active === dialog.value)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && (active === last || active === dialog.value)) { event.preventDefault(); first.focus(); }
}
watch(() => props.content?.locale, () => { overrideLocale.value = null; });
watch([available, isEditing], () => { close(); if (!available.value) { query.value = ''; category.value = 'all'; } });
onBeforeUnmount(() => { destroyed = true; focusSequence++; opener = null; });
</script>

<style scoped>
.learning-library{--canvas:var(--58680c68-e2cd-4ff9-bd05-3c5357f142eb,#ece4d3);--surface:var(--b8e9b391-71ce-4310-9442-0961b32b4489,#faf6ed);--text:var(--a7a3194c-5a7f-4a26-a014-0306d2f49eae,#14161c);--accent:var(--16f1c48a-4cfd-4201-a01f-1a876dd5c03d,#8a6212);--border:var(--b0479118-3ec8-4ae5-8a4b-8be2bbb6ab47,#767064);box-sizing:border-box;width:100%;padding:clamp(16px,3vw,32px);color:var(--text);background:var(--canvas);font-family:inherit;line-height:1.5}
.learning-library[data-theme=dark]{--canvas:#0e1117;--surface:#171b26;--text:#eef0f4;--accent:#d9b04a;--border:#7d8798}
@media(prefers-color-scheme:dark){.learning-library[data-theme=auto]{--canvas:#0e1117;--surface:#171b26;--text:#eef0f4;--accent:#d9b04a;--border:#7d8798}}
*{box-sizing:border-box}.library-heading{display:flex;justify-content:space-between;align-items:start;gap:24px;flex-wrap:wrap}.library-heading h2{font-size:2rem;line-height:1.2;margin:0}.eyebrow{font-size:.85rem;font-weight:600;color:var(--accent);margin:0 0 8px}.language{display:grid;gap:6px}.search{display:grid;gap:6px;margin:16px 0;max-width:46rem}.language select{min-width:10rem}
input,select,button{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:8px;min-height:44px;padding:10px 14px;max-width:100%}input{width:100%;min-width:0}button{cursor:pointer;transition:box-shadow .18s ease,transform .18s ease}button:not(:disabled):hover{box-shadow:inset 0 0 0 1px var(--accent);transform:translateY(-1px)}select{cursor:pointer}button:disabled,input:disabled,select:disabled{cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,.detail:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.categories{display:flex;gap:8px;flex-wrap:wrap}.categories button[aria-pressed=true]{box-shadow:inset 0 0 0 2px var(--accent);font-weight:700}.result-count,.library-footer{font-size:.875rem}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:16px}.formula-card{text-align:left;display:flex;flex-direction:column;align-items:start;gap:12px;padding:20px;min-width:0}.formula-card strong{font-size:1.125rem}.card-id{font-size:.8rem;color:var(--accent)}code{display:block;font-size:.95rem;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}.tags{display:flex;gap:6px;flex-wrap:wrap;font-size:.75rem}.tags span{padding:2px 8px;border:1px solid var(--border);border-radius:20px}.library-footer{margin-top:24px}.empty{padding:24px 0}
.backdrop{position:fixed;inset:0;z-index:1000;display:flex;justify-content:center;align-items:center;padding:16px;background:rgba(0,0,0,.65)}.detail{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:16px;width:min(100%,760px);max-height:calc(100dvh - 32px);overflow:auto;overscroll-behavior:contain;padding:clamp(16px,3vw,32px);box-shadow:0 12px 48px rgba(0,0,0,.2);overflow-wrap:anywhere}.detail-header{display:flex;justify-content:space-between;align-items:center;gap:16px}.detail h2{font-size:1.6rem;line-height:1.3}.detail h3{margin:24px 0 8px;font-size:1rem}.detail p{margin-top:8px}.notation{padding:16px;background:var(--canvas);border-radius:8px;margin-top:20px}
@media(max-width:480px){.library-heading{gap:12px}.language{width:100%}.backdrop{padding:8px}.detail{max-height:calc(100dvh - 16px)}}
</style>
