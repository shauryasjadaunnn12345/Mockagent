import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  readWorkspaceBearerToken,
  workspaceApiKeyMatches,
} from "./workspace-api-key-utils.ts";

const token = `ma_live_${"a".repeat(64)}`;
const prefix = token.slice(0, 24);
const hash = createHash("sha256").update(token).digest("hex");

test("accepts only well-formed workspace bearer keys", () => {
  assert.equal(readWorkspaceBearerToken(`Bearer ${token}`), token);
  assert.equal(readWorkspaceBearerToken(`bearer ${token}`), token);
  assert.equal(readWorkspaceBearerToken(null), null);
  assert.equal(readWorkspaceBearerToken("Basic abc"), null);
  assert.equal(readWorkspaceBearerToken("Bearer ma_live_short"), null);
  assert.equal(readWorkspaceBearerToken(`Bearer ma_live_${"z".repeat(64)}`), null);
});

test("compares workspace API key hashes and prefixes without accepting revoked substitutions", () => {
  assert.equal(workspaceApiKeyMatches(token, prefix, hash), true);
  assert.equal(workspaceApiKeyMatches(`${token.slice(0, -1)}b`, prefix, hash), false);
  assert.equal(workspaceApiKeyMatches(token, "wrong-prefix", hash), false);
  assert.equal(workspaceApiKeyMatches(token, prefix, "bad-hash"), false);
});
