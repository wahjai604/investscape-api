/** Standalone local browser check. Args: Playwright module path; optional browser executable/provider module. */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createMapApiTestFixture} from './map-api-test-fixture.mjs';

const playwrightPath=process.argv[2];if(!playwrightPath)throw Error('PLAYWRIGHT_MODULE_PATH_REQUIRED');
const {chromium}=await import(pathToFileURL(playwrightPath).href);
let launch={headless:true};
if(process.argv[3]){
  if(/\.(mjs|js)$/.test(process.argv[3])){const {default:provider}=await import(pathToFileURL(process.argv[3]).href);
    launch={...launch,args:provider.args,executablePath:await provider.executablePath()};}
  else launch={...launch,executablePath:process.argv[3],args:['--no-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader']};
}
const f=await createMapApiTestFixture();let browser;let checks=0;
const check=(v,message)=>{assert(v,message);checks++;};
const output=process.argv[4]?pathToFileURL(resolve(process.argv[4])+'/'):new URL('./map-admin-evidence/',import.meta.url);await mkdir(output,{recursive:true});
try{
  browser=await chromium.launch(launch);
  const page=await browser.newPage({viewport:{width:1100,height:1000},timezoneId:'America/Vancouver'});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(f.url+'/ui/map-approval-admin-review.html');
  check(await page.getByRole('button',{name:'Load membership'}).isDisabled(),'unconfigured interface must be disabled');
  await page.evaluate(async()=>{
    const {mountMapApprovalAdmin,createMapApprovalClient}=await import('/ui/map-approval-admin.js');
    mountMapApprovalAdmin(document.getElementById('approval'),createMapApprovalClient((path,options)=>fetch('/browser-test'+path,options)));
  });
  await page.getByLabel('Verified member reference').fill('synthetic-browser-target');
  await page.getByRole('button',{name:'Load membership'}).click();
  await page.waitForFunction(()=>document.querySelector('.review').textContent.includes('Revision 0'));
  check(await page.getByRole('button',{name:'Approve member',exact:true}).isDisabled(),'no reason/expiry must block approval');
  const expiry=await page.evaluate(()=>{
    const d=new Date(Date.now()+3600000),pad=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  await page.getByLabel('Approval expiry').fill(expiry);
  await page.getByLabel('Reason for this change').fill('Synthetic browser approval');
  await page.getByRole('button',{name:'Approve member',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('Current persisted revision: 1'));
  check((await page.locator('.review').innerText()).includes('active'),'approved state must come from persisted reload');
  check((await page.locator('.audit').innerText()).includes('Synthetic browser approval'),'approval audit must render');
  const stored=await f.store.inspect(f.principals.admin,'synthetic-browser-target');
  check(stored.ok&&stored.inspection.expiresAt===await page.evaluate(()=>new Date(document.querySelector('.controls input[type=datetime-local]').value).getTime()/1000),
    'local expiry must persist as the same instant');
  await page.getByLabel('Reason for this change').fill('Synthetic browser revocation');
  await page.getByRole('button',{name:'Revoke access'}).click();
  await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('Current persisted revision: 2'));
  check((await page.locator('.review').innerText()).includes('revoked'),'revoked state must come from persisted reload');
  check(await page.getByRole('button',{name:'Revoke access'}).isDisabled(),'already revoked state cannot be revoked again');
  for(const colorScheme of ['light','dark'])for(const width of [320,390,768,1100]){
    await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow at '+width+' '+colorScheme);
    check(await page.evaluate(()=>[...document.querySelectorAll('button,input,textarea')].every(el=>
      el.tagName==='BUTTON'?!!el.textContent.trim():!!document.querySelector(`label[for="${el.id}"]`))),'visible controls must have labels');
    if(width===390||width===1100)await page.screenshot({path:fileURLToPath(new URL(`${width}-${colorScheme}.png`,output)),fullPage:true});
  }
  // Stale reads must not restore an old target; injected slow client is synthetic browser logic only.
  await page.evaluate(async()=>{
    const {mountMapApprovalAdmin}=await import('/ui/map-approval-admin.js');
    window.pendingRead=null;mountMapApprovalAdmin(document.getElementById('approval'),{
      inspect:subject=>new Promise(resolve=>window.pendingRead=()=>resolve({ok:true,member:{subject,revision:5,state:'active',expiresAt:null,audit:[]}})),
      change:async()=>{throw Error('must not write');}});
  });
  await page.getByLabel('Verified member reference').fill('old-target');await page.getByRole('button',{name:'Load membership'}).click();
  await page.getByLabel('Verified member reference').fill('new-target');await page.evaluate(()=>window.pendingRead());
  check(!(await page.locator('.review').innerText()).includes('Revision 5'),'stale target response must be ignored');
  // A lost write receipt must block another write until a persisted reload.
  await page.evaluate(async()=>{
    const {mountMapApprovalAdmin}=await import('/ui/map-approval-admin.js');
    mountMapApprovalAdmin(document.getElementById('approval'),{
      inspect:async subject=>({ok:true,member:{subject,revision:1,state:'active',expiresAt:null,audit:[{
        action:'approve',beforeRevision:0,afterRevision:1,occurredAt:new Date().toISOString(),reason:'<img src=x onerror=alert(1)>'}]}}),
      change:async()=>{throw Error('synthetic lost receipt');}});
  });
  await page.getByLabel('Verified member reference').fill('uncertain-target');await page.getByRole('button',{name:'Load membership'}).click();
  await page.waitForFunction(()=>document.querySelector('.review').textContent.includes('Revision 1'));
  check(await page.locator('.audit img').count()===0,'audit reason must render as text, not HTML');
  await page.getByLabel('Reason for this change').fill('Synthetic uncertain operation');await page.getByRole('button',{name:'Revoke access'}).click();
  await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('Result uncertain'));
  check(await page.getByRole('button',{name:'Revoke access'}).isDisabled(),'lost receipt must invalidate the write snapshot');
  await page.evaluate(async()=>{
    const {mountMapApprovalAdmin}=await import('/ui/map-approval-admin.js');let reads=0;
    mountMapApprovalAdmin(document.getElementById('approval'),{
      inspect:async subject=>({ok:true,member:{subject,revision:++reads===1?1:3,state:reads===1?'active':'revoked',expiresAt:null,audit:[]}}),
      change:async()=>({ok:true,revision:2})});
  });
  await page.getByLabel('Verified member reference').fill('later-revision-target');await page.getByRole('button',{name:'Load membership'}).click();
  await page.waitForFunction(()=>document.querySelector('.review').textContent.includes('Revision 1'));
  await page.getByLabel('Reason for this change').fill('Synthetic delayed receipt');await page.getByRole('button',{name:'Revoke access'}).click();
  await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.includes('Current persisted revision: 3'));
  check((await page.locator('.review').innerText()).includes('Revision 3'),'receipt revision cannot replace a newer persisted revision');
  check(errors.length===0,'browser runtime errors');
  console.log(JSON.stringify({checks,passed:true,timezone:'America/Vancouver',viewports:[320,390,768,1100],themes:['light','dark'],screenshots:4}));
}finally{if(browser)await browser.close();await f.close();}
