/** Actual source Vue compile/render using synthetic browser responses; no WeWeb or live API requests. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const [playwrightPath,executablePath,toolsRoot]=process.argv.slice(2);
if(!playwrightPath||!executablePath||!toolsRoot)throw Error('REVIEW_TOOLS_REQUIRED');
const playwright=await import(pathToFileURL(playwrightPath).href);
const chromium=playwright.chromium??playwright.default?.chromium;
const {parse,compileScript,compileTemplate,compileStyle}=await import(pathToFileURL(path.join(toolsRoot,'node_modules/@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js')).href);
const {build}=await import(pathToFileURL(path.join(toolsRoot,'node_modules/esbuild/lib/main.js')).href);
const component=fileURLToPath(new URL('../../../ui/weweb/research-library',import.meta.url));
const temp=await mkdtemp(path.join(tmpdir(),'research-component-'));let browser,checks=0;
const check=(condition,label)=>{assert(condition,label);checks++;};
try{
  const harness=`import {createApp,reactive,h,nextTick} from 'vue';
import Component from ${JSON.stringify(path.join(component,'src/wwElement.vue'))};
import {registerResearchSessionHost} from ${JSON.stringify(path.join(component,'src/utils/research-session-adapter.js'))};
globalThis.wwLib={getFrontWindow:()=>window,getFrontDocument:()=>document};
let session={issuer:'https://synthetic.supabase.co/auth/v1',subject:'synthetic-member',expiresAt:Date.now()/1000+300,accessToken:'synthetic.header.signature'};
const listeners=new Set();registerResearchSessionHost(window,{issuer:session.issuer,readSession:async()=>session,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}});
const props=reactive({uid:'synthetic-review',content:{enabled:false,apiOrigin:''},wwEditorState:{isEditing:false}});
const app=createApp({setup:()=>()=>h(Component,props)});app.mount('#app');
window.researchCheck={async configure(enabled,editing=false){props.content={enabled,apiOrigin:'https://api.synthetic.invalid'};props.wwEditorState.isEditing=editing;await nextTick();},
signOut(){session=null;for(const fn of listeners)fn();},detach(){app.unmount();},subscriptions:()=>listeners.size};`;
  await writeFile(path.join(temp,'harness-source.js'),harness);
  let css='';
  await build({entryPoints:[path.join(temp,'harness-source.js')],outfile:path.join(temp,'harness.js'),bundle:true,format:'esm',platform:'browser',
    nodePaths:[path.join(toolsRoot,'node_modules')],define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},
    plugins:[{name:'review-vue',setup(builder){builder.onLoad({filter:/\.vue$/},async args=>{
      const {descriptor,errors}=parse(await readFile(args.path,'utf8'),{filename:args.path});assert.equal(errors.length,0);
      const script=compileScript(descriptor,{id:'research-review',genDefaultAs:'__sfc__'});
      const template=compileTemplate({source:descriptor.template.content,filename:args.path,id:'research-review',compilerOptions:{bindingMetadata:script.bindings}});
      assert.equal(template.errors.length,0);const style=compileStyle({source:descriptor.styles[0].content,id:'data-v-research-review',scoped:true});
      assert.equal(style.errors.length,0);css=style.code;
      return {contents:script.content+'\n'+template.code+'\n__sfc__.render=render;__sfc__.__scopeId="data-v-research-review";export default __sfc__;',loader:'js',resolveDir:path.dirname(args.path)};
    });}}]});
  browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader']});
  const page=await browser.newPage({viewport:{width:1100,height:1000},timezoneId:'America/Vancouver'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  let calls=0,withdrawn=false;
  const record=()=>({id:'synthetic-report',revision:1,title:'Synthetic <script> Research',publisher:'Synthetic Publisher',
    canonicalUrl:'https://publisher.invalid/report',geography:['CA-CMA-933'],topics:['housing'],attribution:'Synthetic attribution',summary:'Synthetic permitted summary',
    contentMode:'summary',publishedAt:'2026-09-21',retrievedAt:null,reviewedAt:new Date().toISOString(),reviewDueAt:new Date(Date.now()+60000).toISOString(),
    readValidUntil:new Date(Date.now()+30000).toISOString(),permissionMetadata:{audience:'member',aiAllowed:false,fullTextAllowed:false}});
  await page.route('https://review.synthetic.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:1rem;font-family:Arial;background:#fff;color:#171717}@media(prefers-color-scheme:dark){body{background:#171717;color:#eee}}'+css+'</style><main id="app"></main><script type="module" src="https://assets.synthetic.invalid/harness.js"></script>'}));
  await page.route('https://assets.synthetic.invalid/**',async route=>route.fulfill({contentType:'application/javascript',body:await readFile(path.join(temp,'harness.js')),headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.route('https://api.synthetic.invalid/**',route=>{
    calls++;const isDetail=new URL(route.request().url()).pathname.includes('/items/');
    const body=isDetail?(withdrawn?{error:{code:'RESEARCH_ITEM_UNAVAILABLE'}}:{revision:1,item:record()}):
      {revision:1,items:[record()],coverage:{status:'available'},pagination:{offset:0,limit:25,hasMore:false}};
    return route.fulfill({status:isDetail&&withdrawn?404:200,contentType:'application/json',body:JSON.stringify(body),headers:{'Access-Control-Allow-Origin':'https://review.synthetic.invalid','Cache-Control':'no-store'}});
  });
  await page.goto('https://review.synthetic.invalid/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.researchCheck);
  const search=page.getByRole('button',{name:'Search / refresh'});
  check(await search.isDisabled(),'default-off component');check(calls===0,'no default mount requests');
  await page.evaluate(()=>window.researchCheck.configure(true,true));check(await search.isDisabled(),'editor controls disabled');check(calls===0,'no editor requests');
  await page.evaluate(()=>window.researchCheck.configure(true));await search.click();
  await page.getByRole('button',{name:'Synthetic <script> Research',exact:true}).waitFor();
  check(await page.locator('.research-results script').count()===0,'source titles escaped');
  await page.getByRole('button',{name:'Synthetic <script> Research',exact:true}).click();await page.getByRole('link',{name:'Open original source (new tab)'}).waitFor();
  check((await page.locator('.research-detail').innerText()).includes('Published: 2026-09-21'),'source calendar day preserved in Vancouver timezone');
  check((await page.locator('.research-detail').innerText()).includes('Retrieved: Not supplied'),'unknown retrieval dates preserved');
  check((await page.locator('.research-detail').innerText()).includes('Synthetic permitted summary'),'approved summary rendered');
  for(const colorScheme of ['light','dark'])for(const width of [320,390,768,1100]){
    await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'fits viewport '+width+' '+colorScheme);
  }
  withdrawn=true;await page.getByRole('button',{name:'Synthetic <script> Research',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('unavailable'));
  check(await page.locator('.research-detail').count()===0,'withdrawal clears selected summary');check(await page.locator('.research-results').count()===0,'withdrawal clears old list');
  withdrawn=false;await search.click();await page.getByRole('button',{name:'Synthetic <script> Research',exact:true}).waitFor();
  await page.evaluate(()=>window.researchCheck.signOut());check(await page.locator('.research-results').count()===0,'sign-out clears visible research');
  await page.evaluate(()=>window.researchCheck.detach());check(await page.evaluate(()=>window.researchCheck.subscriptions())===0,'unmount releases subscription');
  check(errors.length===0,'no browser errors');
  console.log(JSON.stringify({passed:true,checks,syntheticOnly:true,actualVueCompile:true,apiCalls:calls}));
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}
