import { createHash, timingSafeEqual } from "node:crypto";

export function readWorkspaceBearerToken(authorization: string | null): string | null {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  return token && /^ma_live_[a-f0-9]{64}$/.test(token) ? token : null;
}

export function workspaceApiKeyMatches(token: string, keyPrefix: string, keyHash: string): boolean {
  if (token.slice(0, 24) !== keyPrefix || !/^[a-f0-9]{64}$/i.test(keyHash)) return false;
  const tokenHash = createHash("sha256").update(token).digest();
  const storedHash = Buffer.from(keyHash, "hex");
  return storedHash.length === tokenHash.length && timingSafeEqual(storedHash, tokenHash);
}
