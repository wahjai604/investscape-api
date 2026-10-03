import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {encode,decode,CODEC_VERSION,DEFAULT_LIMITS} from './transport.ts';
import {decode as browserDecode,decodeFullApiResponse,TRANSPORT_VERSION,DEFAULT_LIMITS as browserLimits} from './browser-decoder.js';
const envelope=(payload:unknown)=>JSON.stringify({codecVersion:CODEC_VERSION,payload});
test('browser decoder matches server vectors including special values and missing keys',()=>{
const vectors=[null,undefined,true,false,0,-0,1,NaN,Infinity,-Infinity,'中文😀\ud800',[undefined,-0,NaN],{status:'partial',raw:{missing:undefined,nan:NaN,infinity:Infinity}}];
for(const vector of vectors){const text=encode(vector);assert.deepStrictEqual(browserDecode(text),decode(text));assert.deepStrictEqual(browserDecode(text),vector);}
assert.deepStrictEqual(browserLimits,DEFAULT_LIMITS);
});
test('prototype and sentinel keys stay own data without pollution',()=>{
const vector=JSON.parse('{"__proto__":{"polluted":true},"constructor":1,"prototype":2,"tag":"nan","payload":["undefined"]}');
const result=browserDecode(encode(vector));assert.deepStrictEqual(result,vector);assert.equal(Object.getPrototypeOf(result),Object.prototype);assert.equal(({} as any).polluted,undefined);assert(Object.hasOwn(result,'__proto__'));
});
test('malformed codec vectors reject consistently',()=>{
const texts=['{','{}',envelope(['number','2']),envelope(['boolean',1]),envelope(['null',1]),envelope(['unknown']),envelope(['object',[['x',['null']],['x',['null']]]]),envelope(['object',[['x']]]),JSON.stringify({codecVersion:'wrong',payload:['null']}),JSON.stringify({codecVersion:CODEC_VERSION,payload:['null'],extra:1}),' {"codecVersion":"'+CODEC_VERSION+'","payload":["number",-0]}'];
for(const text of texts){assert.throws(()=>decode(text));assert.throws(()=>browserDecode(text));}
});
test('every bounded limit rejects identically, including UTF-8 byte boundaries',()=>{
for(const [value,limit] of [[[[[1]]],{maxDepth:1}],[[1,2],{maxNodes:2}],['abc',{maxString:2}],[[1,2],{maxCollection:1}],['abc',{maxBytes:10}]])assert.throws(()=>browserDecode(encode(value),limit));
for(const textValue of ['中文😀','\ud800','\udfff','a']){const text=encode(textValue),bytes=Buffer.byteLength(text);assert.deepStrictEqual(browserDecode(text,{maxBytes:bytes}),textValue);assert.throws(()=>browserDecode(text,{maxBytes:bytes-1}));}
for(const limit of [{maxNodes:0},{wrong:1},{maxDepth:Infinity},null,[]])assert.throws(()=>browserDecode(encode(1),limit));
});
test('API response version and strict envelope accepted only as specified',()=>{
const response={transportVersion:TRANSPORT_VERSION,encodedResult:encode({status:'ok',raw:{value:-0}}),deploymentIdentity:{calc:'declared'}};
assert.deepStrictEqual(decodeFullApiResponse(response),{status:'ok',raw:{value:-0}});
for(const bad of [null,[],{...response,transportVersion:'wrong'},{...response,extra:1},{...response,encodedResult:{}},{...response,deploymentIdentity:null}])assert.throws(()=>decodeFullApiResponse(bad));
});
test('browser script executes in empty VM without Node APIs',()=>{
const source=fs.readFileSync(new URL('./browser-decoder.js',import.meta.url),'utf8');assert(!/\b(Buffer|process|require|module|window|document)\b/.test(source));
const scope=vm.createContext({});vm.runInContext(source.replace(/export /g,'')+';globalThis.browserDecoder = decode;',scope);const result=scope.browserDecoder(encode({x:-0,missing:undefined}));assert(Object.is(result.x,-0));assert(Object.hasOwn(result,'missing'));assert.equal(result.missing,undefined);
});
