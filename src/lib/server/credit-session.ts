import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** userId comes only from authorizeRequest, never from a cookie/body/header. */
export function creditAgentName(userId: string, institutionName: string): string {
  return "credit-user-v1-" + bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([userId, institutionName.trim()]))));
}
