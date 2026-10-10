import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {catalog,labels,locales,categories,filterCatalog,normalizeLocale} from '../../ui/weweb/learning-library/src/utils/catalog.js';

test('all 39 canonical and 18 statistics entries have complete four-language copy and known categories',()=>{
  const inventory=JSON.parse(readFileSync(new URL('../../docs/review/library/canonical-inventory.json',import.meta.url),'utf8'));
  const statistics=JSON.parse(readFileSync(new URL('../../docs/review/library/statistics-inventory.json',import.meta.url),'utf8'));
  assert.equal(catalog.length,57);assert.equal(new Set(catalog.map(item=>item.id)).size,57);
  assert.deepEqual(catalog.filter(item=>item.id.startsWith('F-')).map(item=>item.id),inventory.formulaIds);
  assert.deepEqual(catalog.filter(item=>item.id.startsWith('S-')).map(item=>item.id),statistics.cards.map(item=>item.id));
  assert.deepEqual(Object.fromEntries(categories.map(key=>[key,catalog.filter(item=>item.category===key).length])),{capital:3,time:7,cashflow:3,performance:10,leverage:5,development:11,statistics:18});
  for(const item of catalog){
    assert(categories.includes(item.category));assert(item.lineage);assert(item.formula);assert(item.exampleFormula);
    for(const field of ['name','explanation','example','scope'])for(const locale of locales)assert(item[field][locale]?.trim());
    for(const id of item.relatedIds??[])assert(catalog.some(target=>target.id===id)&&id!==item.id,'valid related target');
  }
  for(const value of Object.values(labels))for(const locale of locales)assert(value[locale]?.trim());
  for(const category of categories)assert(filterCatalog('',category).length>0);
});

test('method cards reconcile flags, capping, aligned pairs, pooling and freshness examples',()=>{
  const byId=id=>catalog.find(item=>item.id===id);
  const rents=[1000,1100,1200,1300,5000];
  const q=p=>{const h=(rents.length-1)*p;return rents[Math.floor(h)]+(h%1)*(rents[Math.ceil(h)]-rents[Math.floor(h)]);};
  const iqr=q(.75)-q(.25),lower=q(.25)-1.5*iqr,upper=q(.75)+1.5*iqr;
  assert.deepEqual([q(.25),q(.75),iqr,lower,upper],[1100,1300,200,800,1600]);
  assert.deepEqual(rents.filter(x=>x<lower||x>upper),[5000]);
  assert(!(lower<lower||lower>upper));assert(!(upper<lower||upper>upper));
  const reference=[1000,1200,1400],mean=reference.reduce((a,b)=>a+b)/reference.length;
  const sampleSD=Math.sqrt(reference.reduce((sum,x)=>sum+(x-mean)**2,0)/(reference.length-1));
  assert.equal((1600-mean)/sampleSD,2);
  const raw=[800,1200,1800,5000],capped=raw.map(x=>Math.min(2000,Math.max(1000,x)));
  assert.deepEqual(capped,[1000,1200,1800,2000]);assert.equal(capped.length,raw.length);
  assert.equal(raw.reduce((a,b)=>a+b)/raw.length,2200);assert.equal(capped.reduce((a,b)=>a+b)/capped.length,1500);
  const x=[1,2,3],y=[2,4,6];
  const covariance=x.reduce((sum,xi,i)=>sum+(xi-2)*(y[i]-4),0)/(x.length-1);
  assert.equal(covariance,2);assert.equal(covariance/(1*2),1);
  assert.equal((100*1000+300*2000)/(100+300),1750);assert.equal((1000+2000)/2,1500);
  assert.equal((5+7)/2,6);assert.equal((1*5+3*6)/(1+3),5.75);
  assert.equal(8/10*100,80);
  assert.equal((Date.UTC(2026,0,31)-Date.UTC(2026,0,1))/86400000,30);
  const expected=[['S-013','200'],['S-014','1,500'],['S-015','= 2; r'],['S-016','1,750'],['S-017','5.75%'],['S-018','80%']];
  for(const [id,value] of expected)assert(byId(id).exampleFormula.includes(value));
  assert(byId('S-013').scope.en.includes('exact fence equality'));
  assert(byId('S-014').scope.en.includes('retain raw data'));
  assert(byId('S-015').scope.en.includes('zero SD'));
  assert(byId('S-016').scope.en.includes('medians cannot be pooled'));
  assert(byId('S-017').scope.en.includes('not engine defaults'));
  assert(byId('S-018').scope.en.includes('Missing is not zero'));
});
test('search finds canonical formula IDs and terms in all languages without interpreting input',()=>{
  for(const locale of locales)assert.equal(filterCatalog('F-502','all',locale)[0]?.id,'F-502');
  assert.equal(filterCatalog('償債覆蓋率')[0]?.id,'F-502');
  assert.equal(filterCatalog('偿债备付率')[0]?.id,'F-502');
  assert.equal(filterCatalog('revenu net', 'leverage','fr-CA').length,0);
  assert.equal(filterCatalog('  CAPITALIZATION  ')[0]?.id,'F-404');
  assert.equal(filterCatalog('<script>alert(1)</script>').length,0);
  assert.equal(filterCatalog(null).length,57);
  assert.equal(filterCatalog('百分位排名')[0]?.id,'S-006');
  assert.equal(filterCatalog('moyenne pondérée')[0]?.id,'S-003');
  assert.equal(normalizeLocale('untrusted-locale'),'en');
});

test('expanded card examples match independently calculated results, including source discrepancies',()=>{
  const money=value=>Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const integer=value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:0});
  const caRate=(1+.052/2)**(1/6)-1;
  const mortgageRate=(1+.06/2)**(1/6)-1;
  const values=[
    ['F-103',String(Math.round((.03+1.2*(.08-.03))*100))+'%'],
    ['F-201',integer(10000*1.1**2)],
    ['F-203',money(1000*(1.01**12-1)/.01)],
    ['F-205',money(1000*(1-1.01**-12)/.01)],
    ['F-206',money(300000*mortgageRate/(1-(1+mortgageRate)**-300))],
    ['F-206',money(300000*.005/(1-1.005**-300))],
    ['F-301',integer(26400+360000)],
    ['F-303',integer(1200000-60000-650000)],
    ['F-402',integer(159312-120000)],
    ['F-405',integer(159312/.05)],
    ['F-406',integer(1200/.04)],
    ['F-407',String(1200000/120000)],
    ['F-408',(84000/243312*100).toFixed(2)+'%'],
    ['F-409','10%'],
    ['F-410',money(-100000+10000/1.08+110000/1.08**2)],
    ['F-503',integer(1800000*.65)],
    ['F-504',money(5400*(1-(1+caRate)**-300)/caRate)],
    ['F-505',String((54000-600000*.045)/300000*100)+'%'],
    ['F-505',String((54000-600000*.075)/300000*100)+'%'],
    ['F-701',integer(200000*.01+1800000*.02+20000000*.03+19000000*.02)],
    ['F-702',money(60000000*.641304*2*.042)],
    ['F-703',integer(2000000*.7*.06*21/12+3000000*.7*.5*.06*15/12)],
    ['F-704',integer(60000000-3232174-600000-300000)],
    ['F-705',integer(87490800-153355-1298955)],
    ['F-705',integer(87490800+153355-1298955)],
    ['F-706',integer(9408000+25794001+8549236)],
    ['F-707',integer(56371262-43751237)],
    ['F-707',((56371262-43751237)/43751237*100).toFixed(2)+'%'],
    ['F-708',money(2.18*12*13906)],
    ['F-708',money(3629581*.05)],
    ['F-708',((1-3629581*.05/(2.18*12*13906))*100).toFixed(4)+'%'],
    ['F-709',integer(1000000*(1.06**2-1))],
    ['F-710',integer(5000000-10*500000*.95)],
    ['F-711',integer(43751237-30000000)],
  ];
  for(const [id,value] of values)assert(catalog.find(item=>item.id===id).example.en.includes(value),id+' computed example '+value);
  assert(Math.abs(-100000+10000/1.1+110000/1.1**2)<1e-8);
  assert.equal(Math.ceil(5000000/(500000*.95)),11);
  assert.equal(23354491+37700229+9533927+4411548,75000195);
  assert.equal(75000196-(23354491+37700229+9533927+4411548),1);
  assert.equal(Number((3232174-60000000*.641304*2*.042).toFixed(2)),1.84);
  assert(catalog.find(item=>item.id==='F-705').scope.en.includes('unresolved'));
  assert(catalog.find(item=>item.id==='F-708').scope.en.includes('reverse-derived'));
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

test('statistics examples distinguish interpolation, ties, sample denominators and growth windows',()=>{
  const byId=id=>catalog.find(item=>item.id===id);
  const includes=(id,value)=>assert(byId(id).exampleFormula.includes(value),id+' worked result '+value);
  includes('S-001',((1000+1200+1800)/3).toFixed(2).replace('1333','1,333'));
  includes('S-002',String((1200+1400)/2).replace('1300','1,300'));
  includes('S-003',((2*1000+1500)/3).toFixed(2).replace('1166','1,166'));
  includes('S-004',String(1800-1000));
  const sorted=[1000,1200,1400,1600],n=sorted.length;
  const q=p=>{const h=(n-1)*p;return sorted[Math.floor(h)]+(h%1)*(sorted[Math.ceil(h)]-sorted[Math.floor(h)]);};
  assert.deepEqual([q(.25),q(.5),q(.75)],[1150,1300,1450]);
  for(const amount of [1150,1300,1450])includes('S-005',amount.toLocaleString('en-US'));
  const reference=[1000,1200,1200,1600],target=1200;
  const midrank=(reference.filter(x=>x<target).length+.5*reference.filter(x=>x===target).length)/reference.length;
  includes('S-006',midrank*100+'%');assert.equal(midrank,.5);
  const rents=[1000,1200,1400],mean=1200,ss=rents.reduce((sum,x)=>sum+(x-mean)**2,0);
  assert.equal(ss,80000);assert.equal(ss/(rents.length-1),40000);assert.equal(Math.sqrt(ss/(rents.length-1)),200);
  includes('S-007',Math.sqrt(ss/rents.length).toFixed(2));
  includes('S-008',(200/1200*100).toFixed(2)+'%');
  includes('S-009',(1100-1000)/1000*100+'%');
  includes('S-010',String(Math.round(((121/100)**.5-1)*100))+'%');
  includes('S-011','[—, —, 110, 120]');includes('S-011',(130-100)/100*100+'%');
  includes('S-012','[100, 110, 90]');
  for(const item of catalog.filter(x=>x.category==='statistics'))for(const locale of locales){
    assert.equal(item.example[locale].replace(/\D/g,''),item.example.en.replace(/\D/g,''),'worked-example numeric parity '+item.id+' '+locale);
    if(locale.startsWith('zh-'))for(const field of ['name','explanation','example','scope'])assert(/\p{Script=Han}/u.test(item[field][locale]));
  }
  assert(byId('S-006').scope.en.includes('fraction'));
  assert(byId('S-007').scope.en.includes('at least two'));
  assert(byId('S-008').scope.en.includes('near-zero'));
  assert(byId('S-009').scope.en.includes('zero prior'));
  assert(byId('S-010').scope.en.includes('ending zero'));
  assert(byId('S-011').scope.en.includes('not zero'));
  assert(byId('S-012').scope.en.includes('non-zero'));
});
