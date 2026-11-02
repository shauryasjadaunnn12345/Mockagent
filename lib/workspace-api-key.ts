import { createAdminClient } from "@/lib/supabase/server";
import { workspaceApiKeyMatches } from "./workspace-api-key-utils";
export { readWorkspaceBearerToken } from "./workspace-api-key-utils";

export async function resolveWorkspaceApiKey(token: string): Promise<{
  id: string;
  workspaceId: string;
} | null> {
  const supabase = createAdminClient();
  const { data: apiKey, error } = await supabase
    .from("api_keys")
    .select("id,workspace_id,key_prefix,key_hash,revoked_at")
    .eq("key_prefix", token.slice(0, 24))
    .maybeSingle();
  if (error) {
    console.error("MockAgent CI: failed to validate workspace API key", error.message);
    throw new Error("Workspace API key could not be validated.");
  }
  if (
    !apiKey ||
    apiKey.revoked_at ||
    !apiKey.workspace_id ||
    !workspaceApiKeyMatches(token, apiKey.key_prefix, apiKey.key_hash)
  ) {
    return null;
  }
  return { id: apiKey.id, workspaceId: apiKey.workspace_id };
}
