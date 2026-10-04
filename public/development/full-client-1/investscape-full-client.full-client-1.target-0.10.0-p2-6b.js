/* InvestScape Full client helper: full-client-1. Generated from pinned reviewed source. */
(function(globalThis){
'use strict';
if(Object.prototype.hasOwnProperty.call(globalThis,'InvestScapeFullClient')) { if(globalThis.InvestScapeFullClient.buildIdentity !== 'full-client-1') throw new Error('Full client build mismatch'); return; }
const PACKAGE_VERSION = '0.10.0-p2-6b';
const FULL_ADAPTER_CONTRACT_VERSION = 'full-adapter-1';
const FIELD_SPEC = [
  // name, kind, rule
  ['landCost', 'num', 'nonneg'], ['provinceState', 'enum', 'province'], ['acquisitionType', 'enum', 'acquisition'], ['multiParcelAssembly', 'bool', null],
  ['parcel2Price', 'num', 'nonneg'], ['parcel2Fmv', 'num', 'nonneg'],
  ['hardCostPsf', 'num', 'nonneg'], ['buildableSf', 'num', 'nonneg'], ['softCostPct', 'num', 'nonneg'], ['contingencyPct', 'num', 'nonneg'],
  ['unitsTotal', 'num', 'nonneg'], ['avgUnitPrice', 'num', 'nonneg'],
  ['ltcPct', 'num', 'ltc'], ['financingRate', 'num', 'nonneg'], ['interestReservePercent', 'num', 'nonneg'], ['withdrawalFactor', 'num', 'fraction'],
  ['commitmentFeePercent', 'num', 'nonneg'], ['seniorRepaymentType', 'enum', 'repayment'], ['sellOffMonths', 'num', 'months'], ['sponsorEquityAmount', 'num', 'nonneg'],
  ['mezzAmount', 'num', 'nonneg'], ['mezzRate', 'num', 'nonneg'], ['mezzAmortizationYears', 'num', 'positive'], ['mezzDrawMonth', 'num', 'months'],
  ['mezzRepaymentType', 'enum', 'repayment'], ['mezzSellOffMonths', 'num', 'months'],
  ['presaleDepositAmount', 'num', 'nonneg'], ['presaleDepositMilestoneMonth', 'num', 'months'],
  ['constructionMonths', 'num', 'constructionMonths'],
  ['landCostActual', 'num', 'nonneg'], ['landCostCommitted', 'num', 'nonneg'], ['hardCostActualPct', 'num', 'nonneg'], ['hardCostCommittedPct', 'num', 'nonneg'],
  ['softCostActualPct', 'num', 'nonneg'], ['softCostCommittedPct', 'num', 'nonneg'], ['contingencyActualPct', 'num', 'nonneg']
];
const FULL_FIELDS = Object.freeze(FIELD_SPEC.map(f => f[0]));
const ENUMS = Object.freeze({
  province: Object.freeze(['BC', 'ON', 'US']),
  acquisition: Object.freeze(['asset_purchase', 'bare_trust']),
  repayment: Object.freeze(['interest_only_bullet', 'amortizing'])
});

const IDENTITY_LIMITS = Object.freeze({ maxKeys: 16, maxKeyLength: 64, maxStringLength: 256 });
const NUMERIC_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const IDENTITY_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const isObjectLike = v => v !== null && typeof v === 'object';
const protoIsPlain = v => { const p = Object.getPrototypeOf(v); return p === null || Object.getPrototypeOf(p) === null; };
/** Plain data object, realm-agnostic (the injected engine may live in another JS realm). */
const isPlain = v => isObjectLike(v) && !Array.isArray(v) && protoIsPlain(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const repr = n => (Object.is(n, -0) ? '-0' : String(n));

function normalizeNumber(v) {
  if (v === undefined) return { state: 'incomplete', code: 'missing' };
  if (v === null) return { state: 'incomplete', code: 'null' };
  if (typeof v === 'number') return Number.isFinite(v) ? { state: 'ok', value: v } : { state: 'invalid', code: 'notFinite' };
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return { state: 'incomplete', code: 'blank' };
    if (!NUMERIC_TEXT.test(s)) return { state: 'invalid', code: 'notNumeric' };
    const n = Number(s);
    return Number.isFinite(n) ? { state: 'ok', value: n } : { state: 'invalid', code: 'notFinite' };
  }
  return { state: 'invalid', code: 'wrongType' };
}
function normalizeEnum(v, set) {
  if (v === undefined) return { state: 'incomplete', code: 'missing' };
  if (v === null) return { state: 'incomplete', code: 'null' };
  if (typeof v !== 'string') return { state: 'invalid', code: 'wrongType' };
  if (v.trim() === '') return { state: 'incomplete', code: 'blank' };
  return set.includes(v) ? { state: 'ok', value: v } : { state: 'invalid', code: 'notInEnum' };
}
function normalizeBool(v) {
  if (v === undefined) return { state: 'incomplete', code: 'missing' };
  if (v === null) return { state: 'incomplete', code: 'null' };
  return typeof v === 'boolean' ? { state: 'ok', value: v } : { state: 'invalid', code: 'wrongType' };
}
const normalizeField = (kind, rule, v) => kind === 'num' ? normalizeNumber(v) : kind === 'enum' ? normalizeEnum(v, ENUMS[rule]) : normalizeBool(v);
const okv = (n, expected) => n && n.state === 'ok' && (expected === undefined || n.value === expected);

/**
 * Activation predicates. A field is ACTIVE only when the raw calculation can read it; an inactive field is never validated, is
 * normalized to null and is passed to the engine as null, so malformed values in it cannot influence anything. When the controlling
 * field is itself missing/invalid the predicate cannot be evaluated: the dependent field is `unevaluated` (also null).
 * Returns 'active' | 'inactive' | 'unevaluated' per field name.
 */
function activation(n) {
  const a = {};
  const prov = n.provinceState, bc = okv(prov) ? prov.value === 'BC' : null;
  const st = bc === null ? 'unevaluated' : bc ? 'active' : 'inactive';
  a.acquisitionType = st; a.multiParcelAssembly = st;
  if (st !== 'active') { a.parcel2Price = st; a.parcel2Fmv = st; }
  else if (!okv(n.multiParcelAssembly)) { a.parcel2Price = 'unevaluated'; a.parcel2Fmv = 'unevaluated'; }
  else if (n.multiParcelAssembly.value !== true) { a.parcel2Price = 'inactive'; a.parcel2Fmv = 'inactive'; }
  else {
    a.parcel2Price = 'active';
    a.parcel2Fmv = !okv(n.parcel2Price) ? 'unevaluated' : n.parcel2Price.value > 0 ? 'active' : 'inactive';
  }
  const sr = n.seniorRepaymentType;
  a.sellOffMonths = !okv(sr) ? 'unevaluated' : sr.value === 'interest_only_bullet' ? 'active' : 'inactive';
  const mz = n.mezzAmount, mzs = !okv(mz) ? 'unevaluated' : mz.value > 0 ? 'active' : 'inactive';
  for (const f of ['mezzRate', 'mezzAmortizationYears', 'mezzDrawMonth', 'mezzRepaymentType']) a[f] = mzs;
  if (mzs !== 'active') a.mezzSellOffMonths = mzs;
  else a.mezzSellOffMonths = !okv(n.mezzRepaymentType) ? 'unevaluated' : n.mezzRepaymentType.value === 'interest_only_bullet' ? 'active' : 'inactive';
  const pd = n.presaleDepositAmount;
  a.presaleDepositMilestoneMonth = !okv(pd) ? 'unevaluated' : pd.value > 0 ? 'active' : 'inactive';
  return a;
}
const ACTIVATION_PREDICATES = Object.freeze({
  acquisitionType: "provinceState === 'BC'", multiParcelAssembly: "provinceState === 'BC'",
  parcel2Price: "provinceState === 'BC' && multiParcelAssembly === true",
  parcel2Fmv: "provinceState === 'BC' && multiParcelAssembly === true && parcel2Price > 0",
  sellOffMonths: "seniorRepaymentType === 'interest_only_bullet'",
  mezzRate: 'mezzAmount > 0', mezzAmortizationYears: 'mezzAmount > 0', mezzDrawMonth: 'mezzAmount > 0', mezzRepaymentType: 'mezzAmount > 0',
  mezzSellOffMonths: "mezzAmount > 0 && mezzRepaymentType === 'interest_only_bullet'",
  presaleDepositMilestoneMonth: 'presaleDepositAmount > 0'
});
/** parcel2Fmv is the one active field that may be blank (null). */
const OPTIONAL_WHEN_ACTIVE = Object.freeze(['parcel2Fmv']);

function normalizeAll(inputs) {
  const n = {};
  const isObj = isPlain(inputs);
  for (const [f, kind, rule] of FIELD_SPEC) n[f] = isObj ? normalizeField(kind, rule, has(inputs, f) ? inputs[f] : undefined) : { state: 'invalid', code: 'inputsNotObject' };
  const act = isObj ? activation(n) : {};
  const fields = {};
  for (const f of FULL_FIELDS) {
    const st = act[f] || 'active';
    if (st === 'active') fields[f] = n[f];
    else fields[f] = { state: st };   // inactive/unevaluated: raw text is discarded (never validated, never echoed)
  }
  return fields;
}
function tokenOf(f) {
  const t = f.state;
  if (t === 'ok') return typeof f.value === 'number' ? 'n:' + repr(f.value) : typeof f.value === 'boolean' ? 'b:' + f.value : 's:' + f.value;
  if (t === 'inactive' || t === 'unevaluated') return t;
  return t + ':' + f.code;
}
function identityOf(fields) {
  return [FULL_ADAPTER_CONTRACT_VERSION, 'full'].concat(FULL_FIELDS.map(k => {
    const f = fields[k];
    // optional active field that is blank: a single stable token whether it was missing, null or whitespace
    if (OPTIONAL_WHEN_ACTIVE.includes(k) && f.state === 'incomplete') return k + '=null';
    return k + '=' + tokenOf(f);
  })).join('|');
}
/** Deterministic input identity: canonical string of the NORMALIZED source fields (never the revision, derived data or engine identity). */
function fullInputIdentity(inputs) { return identityOf(normalizeAll(inputs)); }

function revisionOf(rev) {
  if (rev === undefined || rev === null) return { ok: false, issue: { field: 'inputRevision', code: rev === null ? 'null' : 'missing', category: 'incomplete', params: null } };
  if (typeof rev === 'string') return rev.trim() === '' ? { ok: false, issue: { field: 'inputRevision', code: 'blank', category: 'incomplete', params: null } } : { ok: true, value: rev };
  if (typeof rev === 'number' && Number.isFinite(rev)) return { ok: true, value: rev };
  return { ok: false, issue: { field: 'inputRevision', code: 'wrongType', category: 'invalid', params: null } };
}
const issue = (field, code, category, params) => ({ field, code, category, params: params === undefined ? null : params });
const limitParams = (limit, unit, value) => ({ limit, unit, value });

/** Bounded plain-data engine identity: flat object, <=16 keys, string/finite-number/boolean/null values, data properties only. Returns a frozen snapshot. */
function snapshotEngineIdentity(v) {
  if (v === undefined) return { ok: true, declared: null, canonical: null };
  if (!isPlain(v)) return { ok: false };
  if (Object.getOwnPropertySymbols(v).length) return { ok: false };
  const keys = Object.getOwnPropertyNames(v);
  if (keys.length === 0 || keys.length > IDENTITY_LIMITS.maxKeys) return { ok: false };
  const out = {};
  for (const k of keys.slice().sort()) {
    if (!IDENTITY_KEY.test(k)) return { ok: false };
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !('value' in d) || !d.enumerable) return { ok: false };
    const x = d.value;
    const good = x === null || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x)) || (typeof x === 'string' && x.length <= IDENTITY_LIMITS.maxStringLength);
    if (!good) return { ok: false };
    out[k] = x;
  }
  return { ok: true, declared: Object.freeze(out), canonical: JSON.stringify(Object.keys(out).map(k => [k, out[k]])) };
}


function fullResultMatchesRequest(result, request, deps) {
  if (!isPlain(result) || !isPlain(request)) return false;
  const rev = revisionOf(request.inputRevision);
  if (!rev.ok) return false;
  if (!(result.kind === 'result' && result.calculationPackageVersion === PACKAGE_VERSION && result.contractVersion === FULL_ADAPTER_CONTRACT_VERSION && result.mode === 'full'
    && request.mode === 'full' && request.contractVersion === FULL_ADAPTER_CONTRACT_VERSION && result.inputRevision === rev.value
    && typeof result.inputIdentity === 'string' && result.inputIdentity === fullInputIdentity(request.inputs))) return false;
  if (deps !== undefined && isPlain(deps) && deps.engineIdentity !== undefined) {
    let snap; try { snap = snapshotEngineIdentity(deps.engineIdentity); } catch (e) { return false; }
    if (!snap.ok || !isPlain(result.engine) || result.engine.declaredCanonical !== snap.canonical) return false;
  }
  return true;
}

// Browser-safe companion to transport.ts. No calculation or display policy.
                                                


const CODEC_VERSION = 'investscape-tagged-json-1';
// Operational limits, not financial limits. Check against maximum accepted
// engine output before deploying. A refusal is an error, never truncated data.
const DEFAULT_LIMITS = Object.freeze({ maxBytes: 16 * 1024 * 1024, maxDepth: 32, maxNodes: 700000, maxCollection: 100000, maxString: 1048576 });
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
function decode(text        , overrides                       )          {
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
const TRANSPORT_VERSION = 'full-api-transport-1';
// Decode the exact API response version. Deployment identity is not verified here.
function decodeFullApiResponse(envelope         , overrides                       )          {
 if(!envelope || typeof envelope!=='object' || Array.isArray(envelope)) fail('invalid API envelope');
 const object=envelope                          ;
 if(Object.keys(object).length!==3 || !own(object,'transportVersion') || !own(object,'encodedResult') || !own(object,'deploymentIdentity') || object.transportVersion!==TRANSPORT_VERSION || !object.deploymentIdentity || typeof object.deploymentIdentity!=='object' || Array.isArray(object.deploymentIdentity)) fail('invalid API envelope');
 return decode(object.encodedResult          , overrides);
}

const surface = Object.freeze({buildIdentity:'full-client-1',targetCalculationPackageVersion:PACKAGE_VERSION,contractVersion:FULL_ADAPTER_CONTRACT_VERSION,transportVersion:TRANSPORT_VERSION,codecVersion:CODEC_VERSION,fields:FULL_FIELDS,enums:ENUMS,fullInputIdentity,fullResultMatchesRequest,decodeFullApiResponse});
Object.defineProperty(globalThis,'InvestScapeFullClient',{value:surface,writable:false,configurable:false,enumerable:true});
})(globalThis);
