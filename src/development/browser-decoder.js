// Browser-safe companion to transport.ts. No calculation or display policy.
                                                


export const CODEC_VERSION = 'investscape-tagged-json-1';
// Operational limits, not financial limits. Check against maximum accepted
// engine output before deploying. A refusal is an error, never truncated data.
export const DEFAULT_LIMITS = Object.freeze({ maxBytes: 16 * 1024 * 1024, maxDepth: 32, maxNodes: 700000, maxCollection: 100000, maxString: 1048576 });
const own = (o        , k             ) => Object.prototype.hasOwnProperty.call(o, k);
function limitsOf(overrides                       ) {
  const out                         = { ...DEFAULT_LIMITS };
  if (overrides !== undefined) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('Invalid codec limits');
    for (const k of Object.keys(overrides)) {
      if (!own(out, k) || !Number.isSafeInteger((overrides                          )[k]) || (overrides                          )[k] < 1) throw new Error('Invalid codec limit: ' + k);
      out[k] = (overrides                          )[k];
    }
  }
  return out;
}
function fail(reason        )        { throw new Error('Tagged transport: ' + reason); }
function context(limits                        ) {
  return { limits, nodes: 0, bytes: 0, visit(depth        ) { if (++this.nodes > limits.maxNodes || depth > limits.maxDepth) fail('structural limit'); } };
}
function stringCheck(s         , ctx                            )                      {
  if (typeof s !== 'string' || s.length > ctx.limits.maxString) fail('invalid or oversized string');
  // Bound cumulative string allocation while building the tree; final wire
  // size is also checked. This counter is a conservative lower bound.
  ctx.bytes += utf8ByteLength(s);
  if (ctx.bytes > ctx.limits.maxBytes) fail('byte limit');
}
function arrayCheck(a         , ctx                            )                         {
  if (!Array.isArray(a) || a.length > ctx.limits.maxCollection) fail('invalid or oversized array');
  if (Reflect.ownKeys(a).length !== a.length + 1) fail('sparse array or extra properties');
  for (let i = 0; i < a.length; i++) { const d = Object.getOwnPropertyDescriptor(a, String(i)); if (!d || !own(d, 'value')) fail('array accessor'); }
}
export function decode(text        , overrides                       )          {
  const ctx = context(limitsOf(overrides));
  if (typeof text !== 'string' || utf8ByteLength(text) > ctx.limits.maxBytes) fail('invalid text or byte limit');
  let envelope     ;
  try { envelope = JSON.parse(text); } catch (_) { fail('malformed JSON'); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || Object.keys(envelope).length !== 2 || !own(envelope, 'payload') || envelope.codecVersion !== CODEC_VERSION) fail('invalid envelope');
  function walk(node     , depth        )      {
    ctx.visit(depth);
    if (!Array.isArray(node) || typeof node[0] !== 'string') fail('invalid node');
    const tag = node[0], v = node[1];
    const single                          = { null: null, undefined: undefined, negativeZero: -0, nan: NaN, positiveInfinity: Infinity, negativeInfinity: -Infinity };
    if (own(single, tag)) { if (node.length !== 1) fail('invalid tag arity'); return single[tag]; }
    if (node.length !== 2) fail('invalid tag arity');
    if (tag === 'string') { stringCheck(v, ctx); return v; }
    if (tag === 'boolean') { if (typeof v !== 'boolean') fail('invalid boolean'); return v; }
    if (tag === 'number') { if (typeof v !== 'number' || !Number.isFinite(v) || Object.is(v, -0)) fail('invalid finite number'); return v; }
    if (tag === 'array') { arrayCheck(v, ctx); return v.map((x         ) => walk(x, depth + 1)); }
    if (tag === 'object') {
      arrayCheck(v, ctx);
      const out = {}, seen = new Set();
      for (const entry of v) {
        if (!Array.isArray(entry) || entry.length !== 2) fail('invalid object entry');
        stringCheck(entry[0], ctx);
        if (seen.has(entry[0])) fail('duplicate object key');
        seen.add(entry[0]);
        Object.defineProperty(out, entry[0], { value: walk(entry[1], depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return out;
    }
    fail('unknown tag');
  }
  return walk(envelope.payload, 0);
}


// Count UTF-8 bytes without Node APIs; unpaired surrogates encode as replacements.
function utf8ByteLength(text        )         {
 let bytes=0;
 for(let index=0;index<text.length;index++) {
  const code=text.charCodeAt(index);
  if(code<128) bytes+=1;
  else if(code<2048) bytes+=2;
  else if(code>=0xd800 && code<=0xdbff && index+1<text.length && text.charCodeAt(index+1)>=0xdc00 && text.charCodeAt(index+1)<=0xdfff) {bytes+=4;index++;}
  else bytes+=3;
 }
 return bytes;
}
export const TRANSPORT_VERSION = 'full-api-transport-1';
// Decode the exact API response version. Deployment identity is not verified here.
export function decodeFullApiResponse(envelope         , overrides                       )          {
 if(!envelope || typeof envelope!=='object' || Array.isArray(envelope)) fail('invalid API envelope');
 const object=envelope                          ;
 if(Object.keys(object).length!==3 || !own(object,'transportVersion') || !own(object,'encodedResult') || !own(object,'deploymentIdentity') || object.transportVersion!==TRANSPORT_VERSION || !object.deploymentIdentity || typeof object.deploymentIdentity!=='object' || Array.isArray(object.deploymentIdentity)) fail('invalid API envelope');
 return decode(object.encodedResult          , overrides);
}
