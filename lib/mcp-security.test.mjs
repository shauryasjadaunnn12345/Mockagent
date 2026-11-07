import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { authenticateMcpRequest, createOpenMcpToken } from "./mcp-auth.ts";
import {
  inspectMcpSchema,
} from "./validators.ts";
import { validateAgainstSchemaWithTimeout } from "./mcp-validation.ts";
import {
  enforceToolRateLimit,
  enforceWorkspaceQuota,
} from "./gateway-guards.ts";

const apiToken = `ma_live_${"a".repeat(64)}`;
const apiKey = {
  id: "key-1",
  workspace_id: "workspace-1",
  key_prefix: apiToken.slice(0, 24),
  key_hash: createHash("sha256").update(apiToken).digest("hex"),
  revoked_at: null,
};

function fakeApiKeyClient(row = apiKey) {
  return {
    from(table) {
      assert.equal(table, "api_keys");
      const filters = {};
      return {
        select() { return this; },
        eq(field, value) { filters[field] = value; return this; },
        async maybeSingle() {
          return {
            data: row &&
              row.workspace_id === filters.workspace_id &&
              row.key_prefix === filters.key_prefix
              ? row
              : null,
            error: null,
          };
        },
      };
    },
  };
}

test("validates bearer keys per workspace and rejects missing, wrong, and cross-workspace keys", async () => {
  const settings = { workspaceId: "workspace-1", accessMode: "api_key", openTokenHash: null };
  const validAuthorization = "Be" + "arer " + apiToken;
  assert.deepEqual(
    await authenticateMcpRequest(validAuthorization, null, settings, true, fakeApiKeyClient()),
    { allowed: true, apiKeyId: "key-1" }
  );
  assert.equal((await authenticateMcpRequest(null, null, settings, true, fakeApiKeyClient())).allowed, false);

  const wrongToken = `${apiToken.slice(0, -1)}b`;
  assert.equal(
    (await authenticateMcpRequest("Be" + "arer " + wrongToken, null, settings, true, fakeApiKeyClient())).allowed,
    false
  );
  assert.equal(
    (await authenticateMcpRequest(
      validAuthorization,
      null,
      { ...settings, workspaceId: "workspace-2" },
      true,
      fakeApiKeyClient()
    )).allowed,
    false
  );
});

test("uses a one-time URL token hash without storing or comparing plaintext", async () => {
  const { token, hash } = createOpenMcpToken();
  assert.match(token, /^mcp_live_[a-f0-9]{64}$/);
  const settings = { workspaceId: "workspace-1", accessMode: "open", openTokenHash: hash };
  assert.equal((await authenticateMcpRequest(null, token, settings, false)).allowed, true);
  assert.equal((await authenticateMcpRequest(null, "wrong", settings, false)).allowed, false);
  assert.equal((await authenticateMcpRequest(null, token, settings, true)).allowed, false);
});

test("rejects external refs and schemas deeper than the bounded limit", async () => {
  assert.match(
    inspectMcpSchema({ type: "object", properties: { nested: { $ref: "https://example.test/schema.json" } } }),
    /External JSON Schema references/
  );
  const deepSchema = {};
  let node = deepSchema;
  for (let depth = 1; depth <= 21; depth += 1) {
    node.properties = { nested: {} };
    node = node.properties.nested;
  }
  assert.match(inspectMcpSchema(deepSchema), /maximum depth/);

  const validation = await validateAgainstSchemaWithTimeout(
    { type: "object", properties: { value: { $ref: "https://example.test/schema.json" } } },
    { value: "x" }
  );
  assert.equal(validation.valid, false);
  assert.equal(validation.errors[0].keyword, "invalidSchema");
});

test("consumes workspace quota and reports exhausted quota", async () => {
  const quotaClient = (usage) => ({
    async rpc(name, args) {
      assert.equal(name, "consume_gateway_call");
      assert.equal(args.target_workspace_id, "workspace-1");
      return { data: usage, error: null };
    },
  });
  assert.equal(await enforceWorkspaceQuota(quotaClient(1), "workspace-1", null), null);
  const exhausted = await enforceWorkspaceQuota(quotaClient(-1), "workspace-1", null);
  assert.equal(exhausted.status, 429);
});

test("uses the shared tool rate limiter and maps excess calls to 429", async () => {
  const response = await enforceToolRateLimit("toolset-1", async (scope, key) => {
    assert.equal(scope, "tool");
    assert.equal(key, "toolset-1");
    return {
      success: false,
      reset: Date.now() + 1_000,
      limit: 120,
      remaining: 0,
    };
  });
  assert.equal(response.status, 429);
});
