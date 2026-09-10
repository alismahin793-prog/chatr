import { redactSecretContent } from "./paths";

/**
 * Output handling for Cloud Development operations: secrets are redacted
 * before anything is streamed or persisted, and only a bounded head is ever
 * stored. Commands may echo credentials by accident (a build script printing
 * an env value); this is the single place output is made safe.
 */

export interface StoredOutputHead {
  head: string;
  truncated: boolean;
}

/**
 * Redacts credential-like material, strips NUL bytes, trims, then truncates
 * to `max` characters for persistence. Never stores raw secret values.
 */
export function buildOutputHead(text: string, max = 4000): StoredOutputHead {
  const fixed = redactSecretContent(text).replace(/\u0000/g, "").trim();
  const truncated = fixed.length > max;
  return { head: truncated ? fixed.slice(0, max) : fixed, truncated };
}