/**
 * Deterministic hashing helpers (System 03 / System 06).
 *
 * Used for two purposes only:
 *  - deriving named RNG stream seeds from a master seed and a stream path,
 *  - computing save-file checksums.
 *
 * Neither purpose is cryptographic, and both must be stable across runs,
 * machines and Node versions, so only explicitly-defined integer arithmetic is
 * used. Nothing here depends on locale, float formatting or object key order.
 */

const FNV32_OFFSET = 0x811c9dc5;
const FNV32_PRIME = 0x01000193;

export function fnv1a32(text: string, seed = FNV32_OFFSET): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV32_PRIME) >>> 0;
  }
  return hash >>> 0;
}

const MASK64 = 0xffffffffffffffffn;
const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;

/** FNV-1a 64-bit hash as a BigInt. Stable and dependency-free. */
export function fnv1a64(text: string, seed = FNV64_OFFSET): bigint {
  let hash = seed & MASK64;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hash = (hash ^ BigInt(code & 0xff)) & MASK64;
    hash = (hash * FNV64_PRIME) & MASK64;
    hash = (hash ^ BigInt((code >>> 8) & 0xff)) & MASK64;
    hash = (hash * FNV64_PRIME) & MASK64;
  }
  return hash;
}

export function toHex64(value: bigint): string {
  return (value & MASK64).toString(16).padStart(16, "0");
}

export function hash64Hex(text: string): string {
  return toHex64(fnv1a64(text));
}

export function checksum32Hex(text: string): string {
  return fnv1a32(text).toString(16).padStart(8, "0");
}

/**
 * Canonical JSON: object keys are sorted recursively so that two structurally
 * identical values always serialize to byte-identical text. Save checksums,
 * determinism comparisons and replay verification all depend on this.
 *
 * Values that cannot appear in authoritative state (functions, undefined,
 * symbols, BigInt) are rejected loudly rather than silently dropped.
 */
export function canonicalJson(value: unknown): string {
  return writeCanonical(value, new Set<unknown>());
}

function writeCanonical(value: unknown, seen: Set<unknown>): string {
  if (value === null) return "null";

  const type = typeof value;
  if (type === "number") {
    if (!Number.isFinite(value as number)) {
      throw new TypeError(`canonicalJson cannot serialize non-finite number: ${String(value)}`);
    }
    return JSON.stringify(value);
  }
  if (type === "string" || type === "boolean") return JSON.stringify(value);
  if (type === "undefined") {
    throw new TypeError(
      "canonicalJson cannot serialize undefined: omit optional object fields, they are skipped",
    );
  }
  if (type === "function" || type === "symbol" || type === "bigint") {
    throw new TypeError(`canonicalJson cannot serialize ${type} values`);
  }

  if (seen.has(value)) {
    throw new TypeError("canonicalJson cannot serialize cyclic structures");
  }
  seen.add(value);

  let out: string;
  if (Array.isArray(value)) {
    out = `[${value.map((item) => writeCanonical(item, seen)).join(",")}]`;
  } else {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const parts: string[] = [];
    for (const key of keys) {
      const entry = record[key];
      if (entry === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${writeCanonical(entry, seen)}`);
    }
    out = `{${parts.join(",")}}`;
  }

  seen.delete(value);
  return out;
}
