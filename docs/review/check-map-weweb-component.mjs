/** Synthetic-only verification of the actual packaged Vue component, not a WeWeb deployment. */
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createMapApiTestFixture} from './map-api-test-fixture.mjs';
const [playwrightPath,executablePath,toolsRoot]=process.argv.slice(2);
if(!playwrightPath||!executablePath||!toolsRoot)throw Error('BROWSER_AND_VUE_TOOL_PATHS_REQUIRED');
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const {parse,compileScript,compileTemplate}=await import(pathToFileURL(path.join(toolsRoot,'node_modules/@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js')).href);
const {build}=await import(pathToFileURL(path.join(toolsRoot,'node_modules/esbuild/lib/main.js')).href);
const repo=fileURLToPath(new URL('../../',import.meta.url)),component=path.join(repo,'ui/weweb/map-approval-admin');
const temp=await mkdtemp(path.join(tmpdir(),'map-component-check-'));let f,browser;let checks=0;
const check=(value,message)=>{assert(value,message);checks++;};
try{
  const harness=`import {createApp,reactive,nextTick,h} from 'vue';
import Component from ${JSON.stringify(path.join(component,'src/wwElement.vue'))};
import {registerMapSessionHost} from ${JSON.stringify(path.join(repo,'ui/map-session-adapter.js'))};
const listeners=new Set(),instances=new Map();let session=null,unregister;let subscriptions=0,unsubscriptions=0;
globalThis.wwLib={getFrontWindow:()=>window,getFrontDocument:()=>document};
window.componentCheck={
 configure(value){session=value;unregister?.();unregister=registerMapSessionHost(window,{issuer:value.issuer,
   readSession:async()=>session,subscribe(fn){subscriptions++;listeners.add(fn);return()=>{unsubscriptions++;listeners.delete(fn);};}});},
 async attach(id,content={enabled:false,apiOrigin:''},editing=false){const state=reactive({uid:id,content,wwEditorState:{isEditing:editing}});
   const app=createApp({setup:()=>()=>h(Component,state)});app.mount(document.getElementById(id));instances.set(id,{app,state});await nextTick();},
 async update(id,content,editing){const x=instances.get(id);if(content!==undefined)x.state.content=content;
   if(editing!==undefined)x.state.wwEditorState.isEditing=editing;await nextTick();},
 detach(id){instances.get(id)?.app.unmount();instances.delete(id);},
 changeSession(value){session=value;for(const listener of [...listeners])listener();},
 stats(){return {subscriptions,unsubscriptions,listeners:listeners.size};}
};`;
  const harnessPath=path.join(temp,'harness-source.js');await writeFile(harnessPath,harness);
  const plugin={name:'review-vue-sfc',setup(b){b.onLoad({filter:/\.vue$/},async args=>{
    const source=await readFile(args.path,'utf8'),{descriptor,errors}=parse(source,{filename:args.path});assert.equal(errors.length,0);
    const script=compileScript(descriptor,{id:'map-admin-review',genDefaultAs:'__sfc__'});
    const compiled=compileTemplate({source:descriptor.template.content,filename:args.path,id:'map-admin-review',compilerOptions:{bindingMetadata:script.bindings}});
    assert.equal(compiled.errors.length,0);
    return {contents:script.content+'\n'+compiled.code+'\n__sfc__.render=render;export default __sfc__;',loader:'js',resolveDir:path.dirname(args.path)};
  });}};
  await build({entryPoints:[harnessPath],outfile:path.join(temp,'harness.js'),bundle:true,format:'esm',platform:'browser',
    nodePaths:[path.join(toolsRoot,'node_modules')],plugins:[plugin],define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'}});
  // Fixture asset mount is test-only. All API requests still use the real scoped composition/verifier/stores.
  f=await createMapApiTestFixture({composition:true,componentAssets:temp});
  browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader']});
  const page=await browser.newPage({viewport:{width:1100,height:1000},timezoneId:'America/Vancouver'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  let apiCalls=0,postCalls=0,hold=false,releaseHeld;
  await page.route('https://dev.synthetic.invalid/**',async route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/review')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/component-check/harness.css"></head><body style="margin:0"><button id="outside">Outside component</button><main id="one"></main><main id="two"></main><script type="module" src="/component-check/harness.js"></script></body></html>'});
    if(!['/component-check/harness.js','/component-check/harness.css'].includes(u.pathname))return route.abort();
    return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'application/javascript',body:await readFile(path.join(temp,path.basename(u.pathname)))});
  });
  await page.route('https://api.synthetic.invalid/**',async route=>{
    const request=route.request();apiCalls++;if(request.method()==='POST')postCalls++;
    if(hold){hold=false;await new Promise(resolve=>releaseHeld=resolve);}
    const u=new URL(request.url()),headers=request.headers();
    // This asserts the browser origin really is the configured rendered-app origin.
    check(headers.origin===f.syntheticOrigin,'actual browser origin matches exact configured Dev origin');
    const r=await fetch(f.url+u.pathname+u.search,{method:request.method(),headers,
      ...(request.postData()?{body:request.postData()}:{})});
    await route.fulfill({status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',
      'Access-Control-Allow-Origin':f.syntheticOrigin},body:await r.text()});
  });
  await page.goto('https://dev.synthetic.invalid/review',{waitUntil:'domcontentloaded',timeout:10000});await page.waitForFunction(()=>!!window.componentCheck);
  const initial={...f.principals.admin,accessToken:f.tokens.admin};
  await page.evaluate(s=>window.componentCheck.configure(s),initial);
  await page.evaluate(()=>window.componentCheck.attach('one'));
  const panel=page.locator('#one');
  check(await panel.getByRole('button',{name:'Load membership'}).isDisabled(),'component defaults disconnected');
  check(await page.evaluate(()=>window.componentCheck.stats().subscriptions)===0,'default mount does not subscribe');
  await page.evaluate(()=>window.componentCheck.update('one',{enabled:true,apiOrigin:'https://api.synthetic.invalid'},true));
  check(await panel.getByRole('button',{name:'Load membership'}).isDisabled(),'editing never connects');
  check(await page.evaluate(()=>window.componentCheck.stats().subscriptions)===0,'editing never subscribes');
  await page.evaluate(()=>window.componentCheck.update('one',undefined,false));
  check(await page.evaluate(()=>window.componentCheck.stats().listeners)===1,'runtime subscribes once');
  await panel.getByLabel('Verified member reference').fill('synthetic-vue-target');
  await panel.getByRole('button',{name:'Load membership'}).click();
  await panel.locator('.review').filter({hasText:'Revision 0'}).waitFor();
  const expiry=await page.evaluate(()=>{const d=new Date(Date.now()+3600000),pad=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;});
  await panel.getByLabel('Approval expiry').fill(expiry);await panel.getByLabel('Reason for this change').fill('Synthetic packaged Vue approval');
  await panel.getByRole('button',{name:'Approve member',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#one [role=status]').textContent.includes('Current persisted revision: 1'));
  check((await panel.locator('.audit').innerText()).includes('Synthetic packaged Vue approval'),'actual signed API/database audit appears in Vue wrapper');
  check(postCalls===1,'approval POST executed once');
  const stored=await f.store.inspect(f.principals.admin,'synthetic-vue-target');check(stored.ok&&stored.inspection.state==='active','approval actually persisted');
  const output=new URL('./map-component-evidence/',import.meta.url);await mkdir(output,{recursive:true});
  for(const colorScheme of ['light','dark'])for(const width of [320,390,768,1100]){
    await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'packaged layout fits '+width+' '+colorScheme);
    if((colorScheme==='light'&&width===390)||(colorScheme==='dark'&&width===1100))
      await page.screenshot({path:fileURLToPath(new URL(`${width}-${colorScheme}.png`,output)),fullPage:true});
  }
  check(await page.locator('#outside').evaluate(el=>getComputedStyle(el).minHeight)!=='44px','component styles do not restyle outside button');
  await page.evaluate(()=>window.componentCheck.attach('two',{enabled:true,apiOrigin:'https://api.synthetic.invalid'}));
  check(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(el=>el.id);return new Set(ids).size===ids.length;}),'multiple wrapper instances have unique control IDs');
  check(await page.evaluate(()=>[...document.querySelectorAll('input,textarea')].every(el=>!!document.querySelector(`label[for="${el.id}"]`))),'instance labels reference their own inputs');
  await page.evaluate(()=>window.componentCheck.detach('two'));
  check(await page.evaluate(()=>window.componentCheck.stats().listeners)===1,'unmount removes its subscription');
  const before=apiCalls;
  await page.evaluate(()=>window.componentCheck.changeSession(null));
  check((await panel.locator('.review').innerText()).includes('No membership loaded'),'sign-out clears current member/audit');
  check(!(await panel.locator('.audit').innerText()).includes('Synthetic packaged Vue approval'),'sign-out clears prior audit');
  await panel.getByLabel('Verified member reference').fill('synthetic-memberA');
  await panel.getByRole('button',{name:'Load membership'}).click();
  await page.waitForFunction(()=>document.querySelector('#one [role=status]').textContent.includes('could not be loaded'));
  check(apiCalls===before,'signed-out request cannot reach the API');
  await page.evaluate(s=>window.componentCheck.changeSession(s),initial);
  await panel.getByLabel('Verified member reference').fill('synthetic-memberA');hold=true;
  await panel.getByRole('button',{name:'Load membership'}).click();
  await page.waitForFunction(()=>document.querySelector('#one [role=status]').textContent.includes('Loading'));
  const deadline=Date.now()+5000;while(!releaseHeld&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  check(!!releaseHeld,'delayed request reached synthetic transport');
  await page.evaluate(s=>window.componentCheck.changeSession(s),{...f.principals.memberB,accessToken:f.tokens.memberB});
  releaseHeld();await page.waitForTimeout(100);
  check((await panel.locator('.review').innerText()).includes('No membership loaded'),'account replacement suppresses delayed prior response');
  await page.evaluate(()=>window.componentCheck.update('one',{enabled:true,apiOrigin:'https://foreign.invalid/path'}));
  check(await panel.getByRole('button',{name:'Load membership'}).isDisabled(),'invalid origin change disconnects and clears');
  await page.evaluate(()=>window.componentCheck.detach('one'));
  check(await page.evaluate(()=>{const s=window.componentCheck.stats();return s.listeners===0&&s.subscriptions===s.unsubscriptions;}),'every subscription disposed exactly once');
  check(await panel.locator('input').count()===0,'unmount clears DOM and private state');
  check(errors.length===0,'no browser runtime exceptions');
  check(f.downstream===0,'no map request fell through to legacy engines');
  console.log(JSON.stringify({checks,passed:true,actualVueComponent:true,syntheticSignedApi:true,apiCalls,postCalls,screenshots:2}));
}finally{if(browser)await browser.close();if(f)await f.close();await rm(temp,{recursive:true,force:true});}
