import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of the Authorization Bearer token against the
 * configured worker token. The length check happens before the XOR compare,
 * which prevents information leaking about byte-by-byte content.
 */
export function isAuthorized(authorizationHeader: string | null | undefined, expectedToken: string): boolean {
  if (typeof authorizationHeader !== "string" || expectedToken.length === 0) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
  if (!match) return false;
  const provided = match[1];
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expectedToken, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}