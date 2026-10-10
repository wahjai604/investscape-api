<template>
  <div class="global-settings" :data-theme="theme" :lang="locale">
    <details>
      <summary>{{ t('settings') }} <span>{{ languageName }} · {{ countryName }} · {{ currency }}</span></summary>
      <div class="settings-body">
        <div class="settings-controls">
          <label>{{ t('language') }}
            <select :value="locale" :disabled="isEditing" @change="change('locale', $event.target.value)">
              <option value="en">English</option><option value="fr-CA">Français</option>
              <option value="zh-Hant">繁體中文</option><option value="zh-Hans">简体中文</option>
            </select>
          </label>
          <label>{{ t('theme') }}
            <select :value="theme" :disabled="isEditing" @change="change('theme', $event.target.value)">
              <option value="light">{{ t('light') }}</option><option value="dark">{{ t('dark') }}</option>
            </select>
          </label>
          <label>{{ t('country') }}
            <select :value="country" :disabled="isEditing" @change="change('homeCountry', $event.target.value)">
              <option value="CA">{{ t('canada') }}</option><option value="US">{{ t('us') }}</option>
            </select>
          </label>
          <label>{{ t('currency') }}
            <select :value="currencyChoice" :disabled="isEditing" @change="change('baseCurrency', $event.target.value)">
              <option value="country-default">{{ t('follow') }}</option>
              <option value="CAD">{{ t('cad') }}</option><option value="USD">{{ t('usd') }}</option>
            </select>
          </label>
          <label>{{ t('start') }}
            <select :value="startingModule" :disabled="isEditing" @change="change('startingModule', $event.target.value)">
              <option v-for="module in ['workspace', 'quick', 'full', 'portfolio', 'market-intel', 'research', 'library', 'community']" :key="module" :value="module">{{ t(module) }}</option>
            </select>
          </label>
        </div>
        <p>{{ t('selected') }}: {{ currency }}</p><p>{{ t('entryPending') }}</p><p>{{ t('device') }}</p><p>{{ t('scope') }}</p>
      </div>
    </details>
  </div>
</template>

<script setup>
import {computed, onMounted, watch} from 'vue';
import {labels} from './utils/labels.js';
const props = defineProps({
  uid: {type: String, required: true}, content: {type: Object, required: true},
  /* wwEditor:start */
  wwEditorState: {type: Object, required: true},
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
const locale = computed(() => ['en', 'fr-CA', 'zh-Hant', 'zh-Hans'].includes(props.content?.locale) ? props.content?.locale : 'en');
const theme = computed(() => props.content?.theme === 'dark' ? 'dark' : 'light');
const country = computed(() => props.content?.homeCountry === 'US' ? 'US' : 'CA');
const currency = computed(() => props.content?.baseCurrency === 'USD' ? 'USD' : 'CAD');
const currencyChoice = computed(() => props.content?.baseCurrencyMode === 'explicit' ? currency.value : 'country-default');
const startingModule = computed(() => ['workspace', 'quick', 'full', 'portfolio', 'market-intel', 'research', 'library', 'community'].includes(props.content?.startingModule) ? props.content?.startingModule : 'library');
const languageName = computed(() => ({en: 'English', 'fr-CA': 'Français', 'zh-Hant': '繁體中文', 'zh-Hans': '简体中文'})[locale.value]);
const t = key => labels[key]?.[locale.value] ?? labels[key]?.en ?? key;
const countryName = computed(() => t(country.value === 'CA' ? 'canada' : 'us'));
function change(field, value) {
  if (isEditing.value) return;
  const allowed = {locale: ['en', 'fr-CA', 'zh-Hant', 'zh-Hans'], theme: ['light', 'dark'], homeCountry: ['CA', 'US'], baseCurrency: ['country-default', 'CAD', 'USD'], startingModule: ['workspace', 'quick', 'full', 'portfolio', 'market-intel', 'research', 'library', 'community']};
  if (!allowed[field]?.includes(value)) return;
  const current = {locale: locale.value, theme: theme.value, homeCountry: country.value, baseCurrency: currencyChoice.value, startingModule: startingModule.value};
  if (current[field] === value) return;
  emit('trigger-event', {name: 'preferenceChange', event: {field, value}});
}
// Mark the actual document language for assistive technology. The editor's native page key stays en.
let mounted = false;
function updateDocument() {
  if (!mounted || isEditing.value) return;
  const frontDocument = wwLib.getFrontDocument();
  frontDocument.documentElement.lang = locale.value;
  if (props.content?.pageTitle) frontDocument.title = props.content?.pageTitle;
}
onMounted(() => {mounted = true; updateDocument();});
watch([locale, () => props.content?.pageTitle, isEditing], updateDocument);
</script>

<style scoped>
.global-settings{--surface:var(--b8e9b391-71ce-4310-9442-0961b32b4489,#faf6ed);--text:var(--a7a3194c-5a7f-4a26-a014-0306d2f49eae,#14161c);--accent:var(--16f1c48a-4cfd-4201-a01f-1a876dd5c03d,#8a6212);--border:var(--b0479118-3ec8-4ae5-8a4b-8be2bbb6ab47,#767064);color:var(--text);background:var(--surface);font:inherit;line-height:1.5;border:1px solid var(--border);border-radius:10px;overflow-wrap:anywhere}
.global-settings[data-theme=dark]{--surface:#171b26;--text:#eef0f4;--accent:#d9b04a;--border:#7d8798}
*{box-sizing:border-box}summary{padding:12px 16px;cursor:pointer;min-height:44px;transition:box-shadow .18s ease}summary:hover{box-shadow:inset 0 0 0 2px var(--accent)}summary span{margin-inline-start:12px;font-size:.875rem}summary:focus-visible,select:focus-visible,button:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.settings-body{padding:0 16px 16px}.settings-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:16px}label{display:grid;gap:6px;min-width:0}select,button{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;min-height:44px;max-width:100%;cursor:pointer}select{width:100%}select:disabled,button:disabled{cursor:default}button{margin-top:16px;transition:box-shadow .18s ease,transform .18s ease}button:hover:not(:disabled){box-shadow:inset 0 0 0 1px var(--accent);transform:translateY(-1px)}p{margin:12px 0 0;font-size:.875rem}
</style>
