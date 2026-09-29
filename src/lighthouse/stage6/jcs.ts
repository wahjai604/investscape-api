/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 *   - object members sorted by their names as UTF-16 code unit sequences
 *     (which is exactly JavaScript's default string comparison);
 *   - numbers serialised with the ECMAScript Number-to-String algorithm
 *     (which is exactly `JSON.stringify(number)`); non-finite numbers are not
 *     JSON and are refused;
 *   - strings serialised as `JSON.stringify` does (RFC 8785 §3.2.2.2 adopts
 *     the same escaping rules); strings are NOT Unicode-normalised;
 *   - no insignificant whitespace.
 *
 * RFC 8785 requires I-JSON input (RFC 7493), so a lone surrogate is refused
 * rather than silently escaped: two digests must never silently collapse
 * distinct inputs, and must never be computed over text that is not valid
 * Unicode.
 */

export class JcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JcsError";
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function serialiseString(value: string): string {
  if (LONE_SURROGATE.test(value)) {
    throw new JcsError("string contains a lone surrogate (not I-JSON)");
  }
  return JSON.stringify(value);
}

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new JcsError("non-finite number");
      return JSON.stringify(value); // ECMAScript Number-to-String; -0 -> "0"
    case "string":
      return serialiseString(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalize(item)).join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new JcsError("only plain JSON objects can be canonicalised");
      }
      const record = value as Record<string, unknown>;
      const members = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${serialiseString(key)}:${canonicalize(record[key])}`);
      return `{${members.join(",")}}`;
    }
    default:
      throw new JcsError(`value of type ${typeof value} is not JSON`);
  }
}
