// Compile and exercise the actual Vue source with offline educational content only.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {catalog,categories,locales,labels,translate} from '../../../ui/weweb/learning-library/src/utils/catalog.js';
const [playwrightPath,executablePath,toolsRoot]=process.argv.slice(2);
if(!playwrightPath||!executablePath||!toolsRoot)throw Error('REVIEW_TOOLS_REQUIRED');
const playwright=await import(pathToFileURL(playwrightPath).href);
const chromium=playwright.chromium??playwright.default?.chromium;
const {parse,compileScript,compileTemplate,compileStyle}=await import(pathToFileURL(path.join(toolsRoot,'node_modules/@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js')).href);
const {build}=await import(pathToFileURL(path.join(toolsRoot,'node_modules/esbuild/lib/main.js')).href);
const component=fileURLToPath(new URL('../../../ui/weweb/learning-library',import.meta.url));
const evidence=fileURLToPath(new URL('./evidence',import.meta.url));
const temp=await mkdtemp(path.join(tmpdir(),'library-component-'));let browser,checks=0;
const check=(condition,label)=>{assert(condition,label);checks++;};
const opened={all:{},filtered:{}};
try{
  const harness=`import {createApp,reactive,h,nextTick} from 'vue';
import Component from ${JSON.stringify(path.join(component,'src/wwElement.vue'))};
globalThis.wwLib={getFrontWindow:()=>window,getFrontDocument:()=>document};
const props=reactive({uid:'learning-review',content:{enabled:false,locale:'en',theme:'auto'},wwEditorState:{isEditing:false}});
const events=[];
const app=createApp({setup:()=>()=>h(Component,{...props,onTriggerEvent:event=>events.push(event)})});app.mount('#app');
window.libraryCheck={events,async configure(enabled,locale='en',editing=false,theme='auto'){props.content={enabled,locale,theme};props.wwEditorState.isEditing=editing;await nextTick();},detach(){app.unmount();}};`;
  await writeFile(path.join(temp,'harness-source.js'),harness);
  let css='';
  await build({entryPoints:[path.join(temp,'harness-source.js')],outfile:path.join(temp,'harness.js'),bundle:true,format:'esm',platform:'browser',
    nodePaths:[path.join(toolsRoot,'node_modules')],define:{__VUE_OPTIONS_API__:'true',__VUE_PROD_DEVTOOLS__:'false',__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:'false'},
    plugins:[{name:'review-vue',setup(builder){builder.onLoad({filter:/\.vue$/},async args=>{
      const {descriptor,errors}=parse(await readFile(args.path,'utf8'),{filename:args.path});assert.equal(errors.length,0);
      const script=compileScript(descriptor,{id:'learning-review',genDefaultAs:'__sfc__'});
      const template=compileTemplate({source:descriptor.template.content,filename:args.path,id:'learning-review',compilerOptions:{bindingMetadata:script.bindings}});
      assert.equal(template.errors.length,0);
      const style=compileStyle({source:descriptor.styles[0].content,id:'data-v-learning-review',scoped:true});assert.equal(style.errors.length,0);css=style.code;
      return {contents:script.content+'\n'+template.code+'\n__sfc__.render=render;__sfc__.__scopeId="data-v-learning-review";export default __sfc__;',loader:'js',resolveDir:path.dirname(args.path)};
    });}}]});
  browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage','--single-process','--no-zygote','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader']});
  const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[],unexpected=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const url=route.request().url();
    if(url==='https://library.synthetic.invalid/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}'+css+'</style><main id="app"></main><script type="module" src="https://library.synthetic.invalid/harness.js"></script>'});
    if(url==='https://library.synthetic.invalid/harness.js')return route.fulfill({contentType:'application/javascript',body:await readFile(path.join(temp,'harness.js'))});
    unexpected.push(url);return route.abort();
  });
  await page.goto('https://library.synthetic.invalid/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.libraryCheck);
  check(await page.locator('.formula-card').count()===0,'default off');
  await page.evaluate(()=>window.libraryCheck.configure(true,'en',true));
  check(await page.locator('.formula-card:disabled').count()===catalog.length,'editor interactions disabled');
  check(await page.evaluate(()=>window.libraryCheck.events.length)===0,'editor and external prop updates do not emit language events');
  await page.evaluate(()=>window.libraryCheck.configure(true,'en'));
  await page.locator('.formula-card').filter({hasText:'S-009'}).click();
  for (const locale of ['fr-CA','zh-Hant','zh-Hans','en']) {
    await page.getByRole('combobox').selectOption(locale);
    const item=catalog.find(item=>item.id==='S-009');
    check(await page.getByRole('dialog').getByRole('heading',{name:translate(item.name,locale),exact:true}).count()===1,'local language changes an open detail '+locale);
    check(await page.locator('.learning-library').getAttribute('lang')===locale,'root language follows selection '+locale);
    check((await page.locator('.tag-legend').innerText())===translate(labels.propertyTags,locale),'localized property-type legend '+locale);
    const event=await page.evaluate(()=>window.libraryCheck.events.at(-1));
    check(event.name==='localeChange' && event.event.value===locale,'declared language event carries exact supported value '+locale);
  }
  await page.getByRole('combobox').selectOption('en');
  check(await page.evaluate(()=>window.libraryCheck.events.length)===4,'same language selection emits no duplicate');
  await page.evaluate(()=>window.libraryCheck.configure(true,'fr-CA'));
  check(await page.getByRole('dialog').getByRole('heading',{name:translate(catalog.find(x=>x.id==='S-009').name,'fr-CA'),exact:true}).count()===1,'external locale replaces local fallback while detail remains open');
  check(await page.evaluate(()=>window.libraryCheck.events.length)===4,'external locale update emits no loop');
  await page.evaluate(()=>window.libraryCheck.configure(true,'unsupported'));
  check(await page.locator('.learning-library').getAttribute('lang')==='en','unknown host locale safely falls back to English');
  await page.keyboard.press('Escape');
  for(const locale of locales){
    await page.evaluate(locale=>window.libraryCheck.configure(true,locale),locale);
    await page.getByRole('button',{name:translate(labels.all,locale),exact:true}).click();
    opened.all[locale]=[];
    for(const item of catalog){
      const card=page.locator('.formula-card').filter({hasText:item.id});
      await card.click();const dialog=page.getByRole('dialog');await dialog.waitFor();
      check(await dialog.getByRole('heading',{name:translate(item.name,locale),exact:true}).count()===1,'detail '+locale+' '+item.id);
      check((await dialog.innerText()).includes(translate(item.explanation,locale)),'translated explanation '+locale+' '+item.id);
      check((await dialog.innerText()).includes(translate(item.scope,locale)),'translated limits '+locale+' '+item.id);
      check((await dialog.innerText()).includes(translate(item.example,locale)),'translated example '+locale+' '+item.id);
      check((await dialog.innerText()).includes(item.formula),'untranslated formula '+locale+' '+item.id);
      opened.all[locale].push(item.id);
      await page.keyboard.press('Escape');
      check(await page.getByRole('dialog').count()===0,'Escape closes');
      check(await card.evaluate(node=>document.activeElement===node),'focus restored');
    }
    opened.filtered[locale]=[];
    for(const category of categories){
      await page.getByRole('button',{name:translate(labels[category],locale),exact:true}).click();
      const matching=catalog.filter(item=>item.category===category);
      check(await page.locator('.formula-card').count()===matching.length,'category count '+locale+' '+category);
      for(const item of matching){
        await page.locator('.formula-card').filter({hasText:item.id}).click();
        check(await page.getByRole('dialog').getByRole('heading',{name:translate(item.name,locale),exact:true}).count()===1,'category opens '+locale+' '+item.id);
        opened.filtered[locale].push(item.id);
        await page.getByRole('button',{name:translate(labels.close,locale),exact:true}).click();
      }
    }
  }
  await page.evaluate(()=>window.libraryCheck.configure(true,'en'));
  await page.getByRole('button',{name:'All',exact:true}).click();
  const search=page.getByRole('searchbox');
  await search.fill('償債覆蓋率');check(await page.locator('.formula-card').count()===1,'cross-language search');
  await search.fill('<script>alert(1)</script>');check(await page.locator('.formula-card').count()===0,'search safely yields empty');
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();check(await page.locator('.formula-card').count()===catalog.length,'clear filters');
  await page.getByRole('button',{name:labels.statistics.en,exact:true}).click();
  const statisticsOpener=page.locator('.formula-card').filter({hasText:'S-010'});
  await statisticsOpener.click();
  const relatedDialog=page.getByRole('dialog');
  await page.keyboard.press('Tab');
  check(await relatedDialog.getByRole('button',{name:'Close',exact:true}).evaluate(node=>document.activeElement===node),'related dialog initial Tab');
  await page.keyboard.press('Shift+Tab');
  check(await relatedDialog.getByRole('button').last().evaluate(node=>document.activeElement===node),'related dialog wraps backward');
  await page.keyboard.press('Tab');
  check(await relatedDialog.getByRole('button',{name:'Close',exact:true}).evaluate(node=>document.activeElement===node),'related dialog wraps forward');
  await relatedDialog.getByRole('button',{name:'F-202 · Future Value',exact:true}).click();
  check(await relatedDialog.getByRole('heading',{name:'Future Value',exact:true}).count()===1,'related canonical card opens outside current filter');
  await page.keyboard.press('Escape');
  check(await statisticsOpener.evaluate(node=>document.activeElement===node),'related navigation restores original card');
  check(await page.locator('.formula-card').count()===catalog.filter(item=>item.category==='statistics').length,'related navigation preserves category filter');
  await page.getByRole('button',{name:labels.economics.en,exact:true}).click();
  const economicsOpener=page.locator('.formula-card').filter({hasText:'EC-006'});
  await economicsOpener.click();
  await page.getByRole('dialog').getByRole('button',{name:'F-405 · Direct Capitalization',exact:true}).click();
  check(await page.getByRole('dialog').getByRole('heading',{name:'Direct Capitalization',exact:true}).count()===1,'economics reuses valuation card');
  await page.keyboard.press('Escape');
  check(await economicsOpener.evaluate(node=>document.activeElement===node),'economics related navigation restores opener');
  check(await page.locator('.formula-card').count()===9,'economics related navigation preserves filter');
  for(const locale of locales){
    await page.evaluate(locale=>window.libraryCheck.configure(true,locale),locale);
    await page.getByRole('button',{name:translate(labels.taxes,locale),exact:true}).click();
    for(const id of ['TX-004','TX-011']){
      const opener=page.locator('.formula-card').filter({hasText:id});await opener.click();
      const dialog=page.getByRole('dialog');
      await dialog.getByRole('button',{name:'F-303 · '+translate(catalog.find(x=>x.id==='F-303').name,locale),exact:true}).click();
      check(await dialog.getByRole('heading',{name:translate(catalog.find(x=>x.id==='F-303').name,locale),exact:true}).count()===1,'tax disposal links to net sale proceeds '+id+' '+locale);
      await page.keyboard.press('Escape');
      check(await opener.evaluate(node=>document.activeElement===node),'tax related opener restored '+id+' '+locale);
      check(await page.locator('.formula-card').count()===15,'tax related filter preserved '+id+' '+locale);
    }
  }
  await page.evaluate(()=>window.libraryCheck.configure(true,'en'));
  await page.getByRole('button',{name:'All',exact:true}).click();
  for(const locale of locales)for(const colorScheme of ['light','dark']){
    await page.evaluate(locale=>window.libraryCheck.configure(true,locale),locale);
    await page.setViewportSize({width:320,height:1000});await page.emulateMedia({colorScheme});
    for(const id of ['S-005','S-013','S-015','S-016','S-018','EC-001','EC-002','EC-003','EC-004','EC-005','EC-006','EC-008','FI-001','FI-002','FI-011','FI-012','TX-004','TX-008','TX-011','TX-013','TX-014','DV-001','DV-003','LU-001','LU-002']){
      await page.locator('.formula-card').filter({hasText:id}).click();
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'long statistical formula reflow '+id+' '+locale+' '+colorScheme);
      const dimensions=await page.getByRole('dialog').evaluate(node=>({scroll:node.scrollWidth,width:node.clientWidth}));
      check(dimensions.scroll<=dimensions.width,'statistics dialog reflow '+id+' '+locale+' '+colorScheme);
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize({width:1100,height:1000});await page.emulateMedia({colorScheme:'light'});
  await page.evaluate(()=>window.libraryCheck.configure(true,'en'));
  await page.getByRole('button',{name:'All',exact:true}).click();
  await page.locator('.formula-card').filter({hasText:'F-404'}).click();
  await page.keyboard.press('Tab');check(await page.getByRole('button',{name:'Close',exact:true}).evaluate(node=>document.activeElement===node),'focus trap forward');
  await page.keyboard.press('Shift+Tab');check(await page.getByRole('button',{name:'Close',exact:true}).evaluate(node=>document.activeElement===node),'focus trap backward');
  await mkdir(evidence,{recursive:true});
  await page.screenshot({path:path.join(evidence,'detail-en-light.png'),fullPage:false});
  for(const colorScheme of ['light','dark'])for(const width of [320,390,768,1100]){
    await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'detail reflow '+width+' '+colorScheme);
    const dimensions=await page.getByRole('dialog').evaluate(node=>({scroll:node.scrollWidth,width:node.clientWidth}));
    check(dimensions.scroll<=dimensions.width,'dialog no horizontal overflow '+width+' '+colorScheme);
    await page.keyboard.press('Escape');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'cards reflow '+width+' '+colorScheme);
    await page.locator('.formula-card').filter({hasText:'F-404'}).click();
  }
  await page.setViewportSize({width:1100,height:1000});await page.emulateMedia({colorScheme:'dark'});
  await page.keyboard.press('Escape');
  await page.getByRole('combobox',{name:'Language',exact:true}).selectOption('fr-CA');
  await page.locator('.formula-card').filter({hasText:'F-404'}).click();
  check(await page.getByRole('dialog').getByRole('heading',{name:'Taux de capitalisation',exact:true}).count()===1,'language control updates copy');
  await page.screenshot({path:path.join(evidence,'detail-fr-dark.png'),fullPage:false});
  await page.setViewportSize({width:390,height:1000});
  await page.screenshot({path:path.join(evidence,'detail-fr-mobile-dark.png'),fullPage:false});
  await page.evaluate(()=>window.libraryCheck.configure(false,'fr-CA'));
  check(await page.getByRole('dialog').count()===0,'disable clears modal');
  check(await page.locator('.formula-card').count()===0,'disable clears cards');
  await page.evaluate(()=>window.libraryCheck.detach());check(await page.locator('.learning-library').count()===0,'clean unmount');
  check(unexpected.length===0,'zero external requests');check(errors.length===0,'zero browser errors');
  const result={passed:true,checks,actualVueCompile:true,externalRequests:unexpected.length,uniqueCards:catalog.length,locales,opened,sourceOnly:true,categoryCounts:Object.fromEntries(categories.map(key=>[key,catalog.filter(item=>item.category===key).length]))};
  await writeFile(path.join(evidence,'verification.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}
