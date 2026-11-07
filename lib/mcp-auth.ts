import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { createAdminClient } from "./supabase/server";
import { readWorkspaceBearerToken, workspaceApiKeyMatches } from "./workspace-api-key-utils.ts";

export interface McpAuthSettings {
  workspaceId: string;
  accessMode: "api_key" | "open";
  openTokenHash: string | null;
}

export interface McpAuthResult {
  allowed: boolean;
  apiKeyId: string | null;
}

function hashMatches(token: string, expectedHash: string | null): boolean {
  if (!expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const actual = createHash("sha256").update(token).digest();
  const expected = Buffer.from(expectedHash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export async function authenticateMcpRequest(
  authorization: string | null,
  urlToken: string | null,
  settings: McpAuthSettings,
  requireApiKey: boolean,
  supabase?: ReturnType<typeof createAdminClient>
): Promise<McpAuthResult> {
  const bearer = readWorkspaceBearerToken(authorization);
  if (authorization && !bearer) return { allowed: false, apiKeyId: null };
  if (settings.accessMode === "api_key" && !bearer) {
    return { allowed: false, apiKeyId: null };
  }
  if (requireApiKey && !bearer) return { allowed: false, apiKeyId: null };

  if (settings.accessMode === "open" && !hashMatches(urlToken ?? "", settings.openTokenHash)) {
    return { allowed: false, apiKeyId: null };
  }

  if (!bearer) return { allowed: true, apiKeyId: null };
  const admin = supabase ?? (await import("./supabase/server.ts")).createAdminClient();
  const { data: apiKey, error } = await admin
    .from("api_keys")
    .select("id, workspace_id, key_prefix, key_hash, revoked_at")
    .eq("workspace_id", settings.workspaceId)
    .eq("key_prefix", bearer.slice(0, 24))
    .maybeSingle();
  if (error) {
    console.error("MockAgent MCP: failed to validate workspace API key", error.message);
    return { allowed: false, apiKeyId: null };
  }
  if (
    !apiKey ||
    apiKey.revoked_at ||
    apiKey.workspace_id !== settings.workspaceId ||
    !workspaceApiKeyMatches(bearer, apiKey.key_prefix, apiKey.key_hash)
  ) {
    return { allowed: false, apiKeyId: null };
  }
  return { allowed: true, apiKeyId: apiKey.id };
}

export function createOpenMcpToken(): { token: string; hash: string } {
  const token = `mcp_live_${randomBytes(32).toString("hex")}`;
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}
