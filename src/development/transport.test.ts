import test from 'node:test';
import assert from 'node:assert/strict';
import {encode,decode,CODEC_VERSION} from './transport.ts';
const env=(payload: unknown)=>JSON.stringify({codecVersion:CODEC_VERSION,payload});
test('all primitive categories and nested partial output roundtrip',()=>{
const v={status:'partial',raw:{finite:2,negativeZero:-0,optional:{a:NaN,b:Infinity,c:-Infinity,u:undefined}},sections:{optional:'nonFinite'},array:[null,undefined,true,'x']};assert.deepStrictEqual(decode(encode(v)),v);assert(Object.hasOwn((decode(encode(v)) as any).raw.optional,'u'));
});
test('sentinel-looking objects and prototype keys remain ordinary data',()=>{
const v=JSON.parse('{"__proto__":{"polluted":true},"constructor":1,"prototype":2,"tag":"nan","payload":["undefined"]}');const got=decode(encode(v)) as any;assert.deepStrictEqual(got,v);assert.equal({}.polluted,undefined);assert.equal(Object.getPrototypeOf(got),Object.prototype);
});
test('missing and undefined differ; object key order is preserved',()=>{assert.notEqual(encode({}),encode({x:undefined}));assert.deepStrictEqual(Object.keys(decode(encode({z:1,a:2}))),['z','a']);assert(Object.is(decode(encode(-0)),-0));});
test('cycles, getters, exotic values and unsupported array shapes reject',()=>{const cyc: any={};cyc.x=cyc;const getter={get x(){throw new Error('must not execute');}};for(const v of [cyc,getter,new Date(),1n,()=>{},Symbol(),[,1],Object.assign([1],{extra:2})])assert.throws(()=>encode(v));});
test('malformed nodes, duplicate keys, version and envelope reject',()=>{for(const v of [['number','2'],['number',null],['boolean',1],['null',1],['unknown'],['object',[['x',['null']],['x',['null']]]],['object',[['x']]]])assert.throws(()=>decode(env(v)));for(const s of ['{','{}',JSON.stringify({codecVersion:'wrong',payload:['null']}),JSON.stringify({codecVersion:CODEC_VERSION,payload:['null'],extra:1})])assert.throws(()=>decode(s));});
test('depth, nodes, strings, collections and bytes fail closed in both directions',()=>{for(const [v,l] of [[[[[1]]],{maxDepth:1}],[[1,2],{maxNodes:2}],['abc',{maxString:2}],[[1,2],{maxCollection:1}],['abc',{maxBytes:10}]]){assert.throws(()=>encode(v,l as any));assert.throws(()=>decode(encode(v),l as any));}});
test('invalid finite-number tag and invalid limits reject',()=>{assert.throws(()=>decode('{"codecVersion":"'+CODEC_VERSION+'","payload":["number",1e999]}'));assert.throws(()=>decode(env(['number',-0]).replace('["number",0]','["number",-0]')));for(const l of [{maxNodes:0},{wrong:1},{maxDepth:Infinity}])assert.throws(()=>encode(1,l as any));});
