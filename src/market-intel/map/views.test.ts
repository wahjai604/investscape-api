import test from 'node:test';
import assert from 'node:assert/strict';
import {MapViewStore} from './views.ts';
const actor={issuer:'synthetic',subject:'synthetic-subject',expiresAt:1000};
const view={...actor,grantId:'grant',geographyId:'US-STATE-04' as const,layers:{},expiresAt:999};
test('opaque view is actor/grant-bound, cloned and expires in at most five minutes',()=>{
  let clock=100;const store=new MapViewStore({now:()=>clock});const id=store.create(view);
  assert.equal(id.length,43);assert(!id.includes(actor.subject));assert(store.get(id,actor,'grant'));
  assert.equal(store.get(id,{...actor,subject:'other'},'grant'),null);assert.equal(store.get(id,actor,'other'),null);
  const copy=store.get(id,actor,'grant')!;copy.grantId='changed';assert(store.get(id,actor,'grant'));
  clock=400;assert.equal(store.get(id,actor,'grant'),null);
});
test('bounded capacity evicts old views; invalid capacity and expired views cannot be issued',()=>{
  const store=new MapViewStore({now:()=>100,maxViews:1});const old=store.create(view);const current=store.create(view);
  assert.equal(store.get(old,actor,'grant'),null);assert(store.get(current,actor,'grant'));
  assert.throws(()=>store.create({...view,expiresAt:99}));assert.throws(()=>new MapViewStore({maxViews:0}));
});
