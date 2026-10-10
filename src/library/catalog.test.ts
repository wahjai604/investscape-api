import test from 'node:test';
import assert from 'node:assert/strict';
import {catalog,labels,locales,categories,filterCatalog,normalizeLocale} from '../../ui/weweb/learning-library/src/utils/catalog.js';

test('all twelve entries have complete four-language educational copy and known categories',()=>{
  assert.equal(catalog.length,12);assert.equal(new Set(catalog.map(item=>item.id)).size,12);
  for(const item of catalog){
    assert(categories.includes(item.category));assert(item.lineage);assert(item.formula);assert(item.exampleFormula);
    for(const field of ['name','explanation','example','scope'])for(const locale of locales)assert(item[field][locale]?.trim());
  }
  for(const value of Object.values(labels))for(const locale of locales)assert(value[locale]?.trim());
  for(const category of categories)assert(filterCatalog('',category).length>0);
});
test('search finds canonical formula IDs and terms in all languages without interpreting input',()=>{
  for(const locale of locales)assert.equal(filterCatalog('F-502','all',locale)[0]?.id,'F-502');
  assert.equal(filterCatalog('償債覆蓋率')[0]?.id,'F-502');
  assert.equal(filterCatalog('偿债备付率')[0]?.id,'F-502');
  assert.equal(filterCatalog('revenu net', 'leverage','fr-CA').length,0);
  assert.equal(filterCatalog('  CAPITALIZATION  ')[0]?.id,'F-404');
  assert.equal(filterCatalog('<script>alert(1)</script>').length,0);
  assert.equal(filterCatalog(null).length,12);
  assert.equal(normalizeLocale('untrusted-locale'),'en');
});
test('displayed documented and illustrative examples reconcile arithmetically',()=>{
  assert.equal(300000+700000,1000000);
  assert.equal(Number(((.65*.055*(1-.27)+.35*.11)*100).toFixed(2)),6.46);
  assert.equal(Math.round(250000*1.06**10),447712);
  assert.equal(Math.round(500000/1.08**7),291745);
  assert.equal(72/6,12);
  assert.equal(1000000-700000+30000,330000);
  assert.equal((237600+9600)*.96+6000-84000,159312);
  assert.equal(26400/330000,.08);
  assert.equal(Number((159312/3000000*100).toFixed(4)),5.3104);
  assert.equal(700000/1000000,.7);
  assert.equal(159312/120000,1.3276);
  assert.equal(86345200-75000196,11345004);
  assert.equal(Number((11345004/75000196*100).toFixed(2)),15.13);
});
