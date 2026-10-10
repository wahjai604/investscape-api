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
const app=createApp({setup:()=>()=>h(Component,props)});app.mount('#app');
window.libraryCheck={async configure(enabled,locale='en',editing=false,theme='auto'){props.content={enabled,locale,theme};props.wwEditorState.isEditing=editing;await nextTick();},detach(){app.unmount();}};`;
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
  check(await page.locator('.formula-card:disabled').count()===12,'editor interactions disabled');
  for(const locale of locales){
    await page.evaluate(locale=>window.libraryCheck.configure(true,locale),locale);
    await page.getByRole('button',{name:translate(labels.all,locale),exact:true}).click();
    opened.all[locale]=[];
    for(const item of catalog){
      const card=page.locator('.formula-card').filter({hasText:item.id});
      await card.click();const dialog=page.getByRole('dialog');await dialog.waitFor();
      check(await dialog.getByRole('heading',{name:translate(item.name,locale),exact:true}).count()===1,'detail '+locale+' '+item.id);
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
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();check(await page.locator('.formula-card').count()===12,'clear filters');
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
  const result={passed:true,checks,actualVueCompile:true,externalRequests:unexpected.length,uniqueCards:catalog.length,locales,opened,sourceOnly:true};
  await writeFile(path.join(evidence,'verification.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{await browser?.close();await rm(temp,{recursive:true,force:true});}
