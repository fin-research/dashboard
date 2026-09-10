import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export interface CreditRunCache {
  get(key: string): string | undefined;
  put(key: string, value: string): void;
}

export function creditCacheKey(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
}

/** Small SQL values; never split a UTF-16 surrogate pair at the storage boundary. */
export function creditCacheParts(text: string): string[] {
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 16_000, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end--;
    parts.push(text.slice(start, end)); start = end;
  }
  return parts;
}
