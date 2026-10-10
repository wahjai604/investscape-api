import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire('/workspace/scratch/304b792f6f09/map-component-tools/package.json');
const parser=require('@babel/parser');
const base=new URL('./',import.meta.url);
const catalog=JSON.parse(await readFile(new URL('copy-catalog.json',base),'utf8'));
const inventory=JSON.parse(await readFile(new URL('copy-inventory.json',base),'utf8'));
const prefs='02eeeb96-2c85-4339-83f0-da9bdffd4a75',copy='33c40b55-031f-41f7-b0ce-5aa3fe05a7e2',legacy='876defac-74c0-4f03-99d1-038f7bd94d68';
export const localeCode=`variables['${prefs}']?.locale ?? variables['${legacy}'] ?? 'en'`;
export const translateCode=phrase=>`variables['${copy}']?.[${JSON.stringify(phrase)}]?.[${localeCode}] ?? ${JSON.stringify(catalog[phrase]?.en??phrase)}`;
const helper=`// Read the shared preference once; localize display text without changing data or API codes.\nconst requestedLocale = ${localeCode};\nconst activeLocale = ['en', 'fr-CA', 'zh-Hant', 'zh-Hans'].includes(requestedLocale) ? requestedLocale : 'en';\nfunction translateCopy(phrase) { return variables['${copy}']?.[phrase]?.[activeLocale] ?? phrase; }\n`;
export function transformBinding(value){
 const prefix=value.__wwtype==='f'?'(':'function displayBinding(){\n',suffix=value.__wwtype==='f'?')':'\n}';
 const source=prefix+value.code+suffix, tree=parser.parse(source), replacements=[];
 function walk(node,parent,key){
  if(!node || typeof node!=='object')return;
  if(node.type==='StringLiteral'){
   const intl=(parent?.type==='NewExpression'||parent?.type==='CallExpression')&&parent.arguments?.[0]===node&&parent.callee?.type==='MemberExpression'&&parent.callee.object?.name==='Intl';
   if(intl&&['en','en-CA'].includes(node.value))replacements.push([node.start-prefix.length,node.end-prefix.length,'activeLocale']);
   else if(catalog[node.value]&&node.value.trim()&&node.value!=='InvestScape'&&node.value!=='Bibliothèque'&&
    !(parent?.type==='ObjectProperty'&&key==='key')&&
    !(parent?.type==='BinaryExpression'&&parent.operator!=='+')&&
    !(parent?.type==='MemberExpression'&&key==='property'))replacements.push([node.start-prefix.length,node.end-prefix.length,`translateCopy(${JSON.stringify(node.value)})`]);
  }
  for(const[k,v]of Object.entries(node)){if(['start','end','loc','extra'].includes(k))continue;if(Array.isArray(v))for(const child of v)walk(child,node,k);else if(v&&typeof v==='object')walk(v,node,k);}
 }
 walk(tree,null,'');if(!replacements.length)return null;
 let transformed=value.code;for(const[start,end,replacement]of replacements.sort((a,b)=>b[0]-a[0]))transformed=transformed.slice(0,start)+replacement+transformed.slice(end);
 const code=helper+(value.__wwtype==='f'?`return (${transformed});`:transformed);
 parser.parse('function verify(){\n'+code+'\n}');return {...value,__wwtype:'js',code};
}
const plans=new Map();
function edit(item,path,value){const key=item.pageId+':'+item.uid;let plan=plans.get(key);if(!plan){plan={pageId:item.pageId,uid:item.uid,name:item.name,edits:[]};plans.set(key,plan);}plan.edits.push({path,value});}
for(const item of inventory){
 let {path,value}=item;
 if(item.uid==='f72eb630-9015-4ab3-b72d-c7d862ebf1c7'){edit(item,path,{__wwtype:'f',code:translateCode('Library'),defaultValue:'Library'});continue;}
 if(typeof value==='string'){if(!value.trim()||value==='InvestScape'||!catalog[value])continue;edit(item,path,{__wwtype:'f',code:translateCode(value),defaultValue:catalog[value].en});}
 else if(value?.__wwtype){const transformed=transformBinding(value);if(transformed)edit(item,path,transformed);}
 else if(path.endsWith('.placeholder')&&value?.en){if(catalog[value.en])edit(item,path+'.en',{__wwtype:'f',code:translateCode(value.en),defaultValue:catalog[value.en].en});}
 else if(Array.isArray(value)&&value.every(option=>typeof option?.label==='string'&&catalog[option.label])){
  edit(item,path,{__wwtype:'js',code:helper+`// Keep submitted option values unchanged; translate only their labels.\nconst options = ${JSON.stringify(value)};\nreturn options.map(option => ({...option, label: translateCopy(option.label)}));`,defaultValue:value});
 }
}
const before=JSON.parse(await readFile(new URL('native-bindings.before.json',base),'utf8'));
const tokens={canvas:'var(--58680c68-e2cd-4ff9-bd05-3c5357f142eb,#ece4d3)',surface:'var(--b8e9b391-71ce-4310-9442-0961b32b4489,#faf6ed)',text:'var(--a7a3194c-5a7f-4a26-a014-0306d2f49eae,#14161c)',muted:'var(--ad6a0593-c7f9-49e0-a41b-e79d57b5d776,#565044)',control:'var(--b0479118-3ec8-4ae5-8a4b-8be2bbb6ab47,#767064)',border:'var(--a1100ea4-71d0-4979-b476-8f308dba537e,#ccc0a8)',negative:'var(--778d4e67-5960-4618-aea9-28fc2fcb9bf7,#b91c1c)'};
// Pair every page-root foreground with its background, including the older login/profile screens.
for(const page of before.pages){
 const roots=page.sections.split('\n').map(line=>line.split(':')[0]).filter(uid=>uid!=='7dc18c1a-77ca-41b9-804a-5cc82f26b011');
 for(const uid of roots)for(const [path,value]of Object.entries({'style.default.backgroundColor':tokens.canvas,'style.default.color':tokens.text}))edit({pageId:page.id,uid,name:page.name+' Root'},path,value);
 if(!['Home','Login','User Profile'].includes(page.name))continue;
 for(const element of page.elements){
  const item={pageId:page.id,uid:element.uid,name:page.name+' Theme'};
  for(const[bp,style]of Object.entries(element.style??{}))for(const[key,value]of Object.entries(style)){
   if(typeof value!=='string'||!value||value.includes('var(--58680')||roots.includes(element.uid)&&['backgroundColor','color'].includes(key))continue;
   if(key==='backgroundColor'&&(/^#fff(?:fff)?$/i.test(value)||value==='#f9fbfd'))edit(item,`style.${bp}.${key}`,tokens.surface);
   if(key==='color'&&(/^(#|rgb|hsl)/.test(value)||value.includes('6e84a3')))edit(item,`style.${bp}.${key}`,/red|255,\s*0|#ff/i.test(value)?tokens.negative:tokens.text);
   if(key==='border'&&/^\d/.test(value))edit(item,`style.${bp}.${key}`,`1px solid ${tokens.control}`);
  }
  if(['ww-input-basic','ww-input','ww-input-select'].includes(element.tag)){
   edit(item,'style.default.backgroundColor',tokens.surface);edit(item,'style.default.color',tokens.text);edit(item,'style.default.border',`1px solid ${tokens.control}`);
  }
 }
}
// Merge repeated property edits after theme pairing without sending conflicting parent/child paths.
const output=[...plans.values()].map(plan=>({...plan,edits:[...new Map(plan.edits.map(edit=>[edit.path,edit])).values()]}));
await writeFile(new URL('native-edits.json',base),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({elements:output.length,properties:output.reduce((n,p)=>n+p.edits.length,0),localization:output.filter(p=>p.edits.some(e=>e.value?.__wwtype)).length}));
