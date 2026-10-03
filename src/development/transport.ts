export type CodecLimits = typeof DEFAULT_LIMITS;


export const CODEC_VERSION = 'investscape-tagged-json-1';
// Operational limits, not financial limits. Check against maximum accepted
// engine output before deploying. A refusal is an error, never truncated data.
export const DEFAULT_LIMITS = Object.freeze({ maxBytes: 16 * 1024 * 1024, maxDepth: 32, maxNodes: 700000, maxCollection: 100000, maxString: 1048576 });
const own = (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k);
function limitsOf(overrides?: Partial<CodecLimits>) {
  const out: Record<string, number> = { ...DEFAULT_LIMITS };
  if (overrides !== undefined) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('Invalid codec limits');
    for (const k of Object.keys(overrides)) {
      if (!own(out, k) || !Number.isSafeInteger((overrides as Record<string, number>)[k]) || (overrides as Record<string, number>)[k] < 1) throw new Error('Invalid codec limit: ' + k);
      out[k] = (overrides as Record<string, number>)[k];
    }
  }
  return out;
}
function fail(reason: string): never { throw new Error('Tagged transport: ' + reason); }
function context(limits: Record<string, number>) {
  return { limits, nodes: 0, bytes: 0, visit(depth: number) { if (++this.nodes > limits.maxNodes || depth > limits.maxDepth) fail('structural limit'); } };
}
function stringCheck(s: unknown, ctx: ReturnType<typeof context>): asserts s is string {
  if (typeof s !== 'string' || s.length > ctx.limits.maxString) fail('invalid or oversized string');
  // Bound cumulative string allocation while building the tree; final wire
  // size is also checked. This counter is a conservative lower bound.
  ctx.bytes += Buffer.byteLength(s, 'utf8');
  if (ctx.bytes > ctx.limits.maxBytes) fail('byte limit');
}
function arrayCheck(a: unknown, ctx: ReturnType<typeof context>): asserts a is unknown[] {
  if (!Array.isArray(a) || a.length > ctx.limits.maxCollection) fail('invalid or oversized array');
  if (Reflect.ownKeys(a).length !== a.length + 1) fail('sparse array or extra properties');
  for (let i = 0; i < a.length; i++) { const d = Object.getOwnPropertyDescriptor(a, String(i)); if (!d || !own(d, 'value')) fail('array accessor'); }
}
export function encode(value: unknown, overrides?: Partial<CodecLimits>): string {
  const ctx = context(limitsOf(overrides)), ancestors = new Set();
  function walk(v: any, depth: number): any[] {
    ctx.visit(depth);
    if (v === null) return ['null'];
    if (v === undefined) return ['undefined'];
    if (typeof v === 'boolean') return ['boolean', v];
    if (typeof v === 'string') { stringCheck(v, ctx); return ['string', v]; }
    if (typeof v === 'number') {
      if (Object.is(v, -0)) return ['negativeZero'];
      if (Number.isNaN(v)) return ['nan'];
      if (v === Infinity) return ['positiveInfinity'];
      if (v === -Infinity) return ['negativeInfinity'];
      return ['number', v];
    }
    if (typeof v !== 'object') fail('unsupported value type');
    if (ancestors.has(v)) fail('cycle');
    ancestors.add(v);
    let result;
    if (Array.isArray(v)) {
      arrayCheck(v, ctx);
      result = ['array', v.map((x: unknown) => walk(x, depth + 1))];
    } else {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) fail('exotic object');
      const keys = Reflect.ownKeys(v);
      if (keys.length > ctx.limits.maxCollection) fail('object collection limit');
      result = ['object', keys.map(k => {
        stringCheck(k, ctx);
        const d = Object.getOwnPropertyDescriptor(v, k);
        if (!d || !own(d, 'value') || !d.enumerable) fail('accessor or non-enumerable property');
        return [k, walk(d.value, depth + 1)];
      })];
    }
    ancestors.delete(v);
    return result;
  }
  const text = JSON.stringify({ codecVersion: CODEC_VERSION, payload: walk(value, 0) });
  if (Buffer.byteLength(text, 'utf8') > ctx.limits.maxBytes) fail('byte limit');
  return text;
}
export function decode(text: string, overrides?: Partial<CodecLimits>): unknown {
  const ctx = context(limitsOf(overrides));
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > ctx.limits.maxBytes) fail('invalid text or byte limit');
  let envelope: any;
  try { envelope = JSON.parse(text); } catch (_) { fail('malformed JSON'); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || Object.keys(envelope).length !== 2 || !own(envelope, 'payload') || envelope.codecVersion !== CODEC_VERSION) fail('invalid envelope');
  function walk(node: any, depth: number): any {
    ctx.visit(depth);
    if (!Array.isArray(node) || typeof node[0] !== 'string') fail('invalid node');
    const tag = node[0], v = node[1];
    const single: Record<string, unknown> = { null: null, undefined: undefined, negativeZero: -0, nan: NaN, positiveInfinity: Infinity, negativeInfinity: -Infinity };
    if (own(single, tag)) { if (node.length !== 1) fail('invalid tag arity'); return single[tag]; }
    if (node.length !== 2) fail('invalid tag arity');
    if (tag === 'string') { stringCheck(v, ctx); return v; }
    if (tag === 'boolean') { if (typeof v !== 'boolean') fail('invalid boolean'); return v; }
    if (tag === 'number') { if (typeof v !== 'number' || !Number.isFinite(v) || Object.is(v, -0)) fail('invalid finite number'); return v; }
    if (tag === 'array') { arrayCheck(v, ctx); return v.map((x: unknown) => walk(x, depth + 1)); }
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

