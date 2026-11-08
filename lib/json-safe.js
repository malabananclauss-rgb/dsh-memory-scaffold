// Canonical-JSON safety net.
//
// The Harness validates tool output as lossless JSON (no undefined, no NaN, no
// functions). Memory directories written by hand can produce optional/undefined
// fields, so every JSON payload we emit or write goes through this sanitizer:
//   object property with undefined/function/symbol -> dropped
//   array element with undefined/function/symbol   -> null
//   NaN / Infinity                                  -> null
//   Date                                            -> ISO string
// Cycles are broken with null.

export function toLosslessJson(value, seen = new WeakSet()) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'undefined' || type === 'function' || type === 'symbol') return undefined;
  if (type === 'boolean' || type === 'string') return value;
  if (type === 'number') return Number.isFinite(value) ? value : null;
  if (type === 'bigint') return value.toString();
  if (type === 'object') {
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return { name: value.name, message: value.message, code: value.code ?? null };
    if (seen.has(value)) return null;
    seen.add(value);
    let result;
    if (Array.isArray(value)) {
      result = value.map((entry) => {
        const safe = toLosslessJson(entry, seen);
        return safe === undefined ? null : safe;
      });
    } else {
      result = {};
      for (const [key, entry] of Object.entries(value)) {
        const safe = toLosslessJson(entry, seen);
        if (safe !== undefined) result[key] = safe;
      }
    }
    seen.delete(value);
    return result;
  }
  return String(value);
}

/** JSON.stringify with the lossless sanitizer applied. */
export function stringifyLossless(value, space = 2) {
  return JSON.stringify(toLosslessJson(value), null, space);
}
