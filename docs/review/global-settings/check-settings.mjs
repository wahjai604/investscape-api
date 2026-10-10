import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {normalizePreferences,changePreference} from '../../../ui/weweb/global-settings/src/utils/preferences.js';
import {labels} from '../../../ui/weweb/global-settings/src/utils/labels.js';
const [playwrightPath,executablePath,toolsRoot]=process.argv.slice(2);
if(!playwrightPath||!executablePath||!toolsRoot)throw Error('REVIEW_TOOLS_REQUIRED');
let checks=0;const check=(value,label)=>{assert(value,label);checks++;};
check(normalizePreferences(null,'zh-Hant','dark').locale==='zh-Hant','imports legacy Traditional Chinese');
check(normalizePreferences(null,'fr','light').locale==='fr-CA','maps legacy French');
check(normalizePreferences({schemaVersion:1,locale:'zh-Hans'},'en').locale==='zh-Hans','global preference wins over legacy');
check(normalizePreferences({schemaVersion:99,locale:'zh-Hans'}).locale==='en','unknown schema is not trusted');
check(normalizePreferences({schemaVersion:1,locale:'unsupported',theme:'unsupported'}).theme==='light','invalid preference fallback');
check(normalizePreferences(null).startingModule==='library','Library is the default app entry');
let preferences=normalizePreferences(null);
preferences=changePreference(preferences,'homeCountry','US');
check(preferences.baseCurrency==='USD','US default currency');
preferences=changePreference(preferences,'baseCurrency','CAD');preferences=changePreference(preferences,'homeCountry','CA');preferences=changePreference(preferences,'homeCountry','US');
check(preferences.baseCurrency==='CAD'&&preferences.baseCurrencyMode==='explicit','explicit currency survives country change');
preferences=changePreference(preferences,'baseCurrency','country-default');
check(preferences.baseCurrency==='USD','restore country default');
check(changePreference(preferences,'locale','<script>').locale==='en','unsupported selection ignored');
check(!Object.hasOwn(normalizePreferences({schemaVersion:1,ownerId:'private',token:'private',inputs:{price:1}}),'ownerId'),'cache strips project/auth fields');
for(const module of ['workspace','quick','full','portfolio','market-intel','research','library','community'])check(changePreference(preferences,'startingModule',module).startingModule===module,'starting module '+module);
check(changePreference(preferences,'startingModule','../../../admin').startingModule==='library','invalid module ignored');
const edits=JSON.parse(await readFile(new URL('./native-edits.json',import.meta.url),'utf8'));
const copy=JSON.parse(await readFile(new URL('./copy-catalog.json',import.meta.url),'utf8'));
for(const entry of Object.values(copy))for(const locale of ['en','fr-CA','zh-Hant','zh-Hans'])check(typeof entry[locale]==='string'&&entry[locale].length>0,'complete shared copy');
const variables={'02eeeb96-2c85-4339-83f0-da9bdffd4a75':normalizePreferences(null),'33c40b55-031f-41f7-b0ce-5aa3fe05a7e2':copy};
// Use the installed runtime's event global; context contains workflow results, not component events.
const wiring=JSON.parse(await readFile(new URL('./runtime-wiring.json',import.meta.url),'utf8'));
const evaluateValue=(id,action,event)=>{
 const value=wiring.workflows.find(w=>w.id===id).actions[action].varValue;
 return new Function('variables','globalContext','context','event',value.__wwtype==='f'?'return ('+value.code+');':value.code)(variables,{browser:{theme:'light'}},{workflow:{}},event);
};
for(const locale of ['en','fr-CA','zh-Hant','zh-Hans'])check(evaluateValue('19b1390e-2d38-4a69-b9aa-40ea4ed2e070','preferences',{field:'locale',value:locale}).locale===locale,'installed settings event '+locale);
for(const module of ['workspace','quick','full','portfolio','market-intel','research','library','community'])check(evaluateValue('1c9d3422-497c-49b4-8f96-8c8b50a7d344','module',{value:module})===module,'installed ribbon event '+module);
check(evaluateValue('1c9d3422-497c-49b4-8f96-8c8b50a7d344','module',{value:'unknown'})==='library','invalid ribbon payload ignored');
check(evaluateValue('0bd5fdf8-21cc-404c-bb27-4188070db89e','preferences',{value:'zh-Hans'}).locale==='zh-Hans','Library event updates global preference');
variables['02eeeb96-2c85-4339-83f0-da9bdffd4a75']={...normalizePreferences(null),startingModule:'research'};
check(evaluateValue('fb1a2169-8f71-4821-9226-33b54fe1324f','module',undefined)==='research','installed app entry uses saved module');
const preservation=JSON.parse(await readFile(new URL('./workflow-preservation.json',import.meta.url),'utf8'));
check(preservation.exactlyPreserved===58&&preservation.unexpectedChanges.length===0,'existing 58 business/Auth workflows preserved');
variables['02eeeb96-2c85-4339-83f0-da9bdffd4a75']=normalizePreferences(null);
for(const plan of edits)for(const edit of plan.edits){
 if(!edit.value?.__wwtype)continue;
 const {code,__wwtype}=edit.value;
 // Compile every display binding; use empty synthetic status/data rather than service connections.
 const execute=new Function('variables','globalContext','context','wwFormulas',__wwtype==='f'?'return ('+code+');':code);
 for(const locale of ['en','fr-CA','zh-Hant','zh-Hans']){
  variables['02eeeb96-2c85-4339-83f0-da9bdffd4a75']={...normalizePreferences(null),locale};
  try{execute(variables,{browser:{url:'https://app.synthetic.invalid/app',environment:'editor',theme:'light'},colors:{}},{item:{data:{}}},{if:(a,b,c)=>a?b:c});}
  catch(error){throw new Error(plan.name+' / '+edit.path+': '+error.message);}
  checks++;
 }
}
const playwright=await import(pathToFileURL(playwrightPath).href),chromium=playwright.chromium??playwright.default?.chromium;
const {parse,compileScript,compileTemplate,compileStyle}=await import(pathToFileURL(path.join(toolsRoot,'node_modules/@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js')).href);
const {build}=await import(pathToFileURL(path.join(toolsRoot,'node_modules/esbuild/lib/main.js')).href);
const root=fileURLToPath(new URL('../../../',import.meta.url)),temp=await mkdtemp(path.join(tmpdir(),'settings-shell-'));let browser;const css=[];
try{
 const harness=`import {createApp,reactive,h,nextTick} from 'vue';
import Settings from ${JSON.stringify(path.join(root,'ui/weweb/global-settings/src/wwElement.vue'))};
import Ribbon from ${JSON.stringify(path.join(root,'ui/weweb/app-ribbon/src/wwElement.vue'))};
import Library from ${JSON.stringify(path.join(root,'ui/weweb/learning-library/src/wwElement.vue'))};
import {normalizePreferences,changePreference} from ${JSON.stringify(path.join(root,'ui/weweb/global-settings/src/utils/preferences.js'))};
globalThis.wwLib={getFrontDocument:()=>document};
const state=reactive({preferences:normalizePreferences(JSON.parse(localStorage.getItem('prefs')||'null')),active:'library',editing:false});state.active=state.preferences.startingModule;const events=[];
function receive(event){events.push(event);if(event.name==='moduleChange')state.active=event.event.value;else{const {field,value}=event.name==='localeChange'?{field:'locale',value:event.event.value}:event.event;state.preferences=changePreference(state.preferences,field,value);localStorage.setItem('prefs',JSON.stringify(state.preferences));}}
let mounts=0;
const NativePanel={props:['name'],mounted(){mounts++;},render(){return h('section',{'data-native':this.name},[h('h1',this.name),h('label',[this.name+' input',h('input',{'data-input':this.name})])]);}};
createApp({setup:()=>()=>h('main',{},[h(Ribbon,{uid:'ribbon',content:{locale:state.preferences.locale,theme:state.preferences.theme,activeModule:state.active},wwEditorState:{isEditing:state.editing},onTriggerEvent:receive}),h(Settings,{uid:'settings',content:{...state.preferences,pageTitle:'InvestScape App'},wwEditorState:{isEditing:state.editing},onTriggerEvent:receive}),h('div',{style:{display:state.active==='library'?'block':'none'}},[h(Library,{uid:'library',content:{enabled:true,locale:state.preferences.locale,theme:state.preferences.theme},wwEditorState:{isEditing:state.editing},onTriggerEvent:receive})]),...['quick','full'].map(name=>h('div',{key:name,style:{display:state.active===name?'block':'none'}},[h(NativePanel,{name})])),...['workspace','portfolio','market-intel','research','community'].map(name=>h('section',{key:name,style:{display:state.active===name?'block':'none'}},name))])}).mount('#app');
window.settingsCheck={state,events,getMounts:()=>mounts,async setEditing(value){state.editing=value;await nextTick();}};`;
 await writeFile(path.join(temp,'source.js'),harness);
 await build({entryPoints:[path.join(temp,'source.js')],outfile:path.join(temp,'harness.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.join(toolsRoot,'node_modules')],define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},plugins:[{name:'vue-review',setup(builder){builder.onLoad({filter:/\.vue$/},async args=>{
  const id='review'+css.length,{descriptor,errors}=parse(await readFile(args.path,'utf8'),{filename:args.path});assert.equal(errors.length,0);
  const script=compileScript(descriptor,{id,genDefaultAs:'__sfc__'}),template=compileTemplate({source:descriptor.template.content,filename:args.path,id,compilerOptions:{bindingMetadata:script.bindings}});assert.equal(template.errors.length,0);
  for(const source of descriptor.styles){const style=compileStyle({source:source.content,id:'data-v-'+id,scoped:true});assert.equal(style.errors.length,0);css.push(style.code);}
  return {contents:script.content+'\n'+template.code+'\n__sfc__.render=render;__sfc__.__scopeId='+JSON.stringify('data-v-'+id)+';export default __sfc__;',loader:'js',resolveDir:path.dirname(args.path)};
 });}}]});
 browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader']});
 const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[],unexpected=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const url=route.request().url();if(url==='https://settings.synthetic.invalid/app')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:Arial}'+css.join('\n')+'</style><div id="app"></div><script type="module" src="https://settings.synthetic.invalid/harness.js"></script>'});if(url==='https://settings.synthetic.invalid/harness.js')return route.fulfill({contentType:'application/javascript',body:await readFile(path.join(temp,'harness.js'))});unexpected.push(url);return route.abort();});
 await page.goto('https://settings.synthetic.invalid/app');await page.waitForFunction(()=>!!window.settingsCheck);
 const initialURL=page.url(),historyLength=await page.evaluate(()=>history.length);
 check(await page.locator('.formula-card').count()===103,'existing Library remains present');
 await page.locator('summary').click();
 for(const locale of ['fr-CA','zh-Hant','zh-Hans','en']){
  await page.locator('.global-settings select').nth(0).selectOption(locale);
  check(await page.locator('.learning-library').getAttribute('lang')===locale,'global language reaches Library '+locale);
  check(await page.locator('.app-ribbon').getAttribute('lang')===locale,'global language reaches ribbon '+locale);
  check(await page.evaluate(()=>document.documentElement.lang)===locale,'actual document language '+locale);
 }
 await page.locator('.learning-library select').selectOption('zh-Hant');
 check(await page.locator('.global-settings select').nth(0).inputValue()==='zh-Hant','Library selector updates global setting');
 await page.locator('.global-settings select').nth(0).selectOption('en');
 await page.getByRole('button',{name:'Development',exact:true}).click();
 await page.locator('[data-input=quick]').fill('12345');
 await page.getByRole('button',{name:'Full Development Studio',exact:true}).click();await page.locator('[data-input=full]').fill('67890');
 await page.getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('button',{name:'Development',exact:true}).click();
 check(await page.locator('[data-input=full]').inputValue()==='67890','Full input retained on panel switch');
 await page.getByRole('button',{name:'Quick Deal Analyzer',exact:true}).click();check(await page.locator('[data-input=quick]').inputValue()==='12345','Quick input retained on panel switch');
 check(await page.evaluate(()=>window.settingsCheck.getMounts())===2,'native panels remain mounted');
 for(const name of ['Workspace','Portfolio','Market Intel','Research','Community','Library'])await page.getByRole('button',{name,exact:true}).click();
 check(page.url()===initialURL&&await page.evaluate(()=>history.length)===historyLength,'all ribbon panels keep URL/history unchanged');
 await page.locator('.global-settings select').nth(2).selectOption('US');check(await page.locator('.global-settings summary').innerText().then(t=>t.includes('USD')),'country default applied');
 await page.locator('.global-settings select').nth(3).selectOption('CAD');await page.locator('.global-settings select').nth(2).selectOption('CA');await page.locator('.global-settings select').nth(2).selectOption('US');check(await page.locator('.global-settings summary').innerText().then(t=>t.includes('CAD')),'currency override retained');
 await page.locator('.global-settings select').nth(4).selectOption('full');await page.reload();await page.waitForFunction(()=>!!window.settingsCheck);
 check(await page.locator('[data-native=full]').isVisible(),'saved preferred entry opens Full');
 check(await page.locator('.global-settings summary').innerText().then(t=>t.includes('CAD')),'country/currency preference restored');
 await page.locator('summary').click();await page.locator('.global-settings select').nth(1).selectOption('dark');await page.reload();await page.waitForFunction(()=>!!window.settingsCheck);
 check(await page.locator('.app-ribbon').getAttribute('data-theme')==='dark','saved theme restored');
 await page.locator('summary').click();
 for(const locale of ['en','fr-CA','zh-Hant','zh-Hans'])for(const theme of ['light','dark'])for(const width of [320,768,1100]){
  await page.setViewportSize({width,height:1000});await page.locator('.global-settings select').nth(0).selectOption(locale);await page.locator('.global-settings select').nth(1).selectOption(theme);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'settings/ribbon reflow '+locale+'/'+theme+'/'+width);
 }
 await page.setViewportSize({width:1100,height:1000});await page.locator('.global-settings select').nth(0).selectOption('zh-Hant');await page.locator('.global-settings select').nth(1).selectOption('dark');
 await page.getByRole('button',{name:'知識庫',exact:true}).click();await page.locator('summary').click();
 const evidence=fileURLToPath(new URL('./evidence',import.meta.url));await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'shell-zh-hant-dark.synthetic.png'),fullPage:false});
 const beforeEvents=await page.evaluate(()=>window.settingsCheck.events.length);await page.evaluate(()=>window.settingsCheck.setEditing(true));check(await page.locator('.global-settings select:disabled').count()===5,'settings disabled in editor');check(await page.locator('.main-ribbon button:disabled').count()===7,'ribbon disabled in editor');check(await page.evaluate(()=>window.settingsCheck.events.length)===beforeEvents,'no editor event loop');
 check(errors.length===0,'no browser errors: '+errors.join(','));check(unexpected.length===0,'no external requests');
 await writeFile(new URL('./checks.json',import.meta.url),JSON.stringify({date:new Date().toISOString(),checks,displayBindings:edits.length,catalogPhrases:Object.keys(copy).length,errors,unexpected,scope:'Pure preference normalization, native display-binding compilation and offline Vue shell/Library interaction. Native WeWeb calculator workflows and real sessions are verified separately.'},null,2)+'\n');console.log(JSON.stringify({checks,errors,unexpected}));
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}
