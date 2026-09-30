import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  checkGatewayRateLimit,
  isGatewayRateLimitConfigured,
} from "@/lib/rate-limit";

export interface ApiKeyProtectedTool {
  id: string;
  user_id: string;
  workspace_id: string;
  require_api_key: boolean;
}

export async function enforceApiKey(
  request: NextRequest,
  tool: ApiKeyProtectedTool
): Promise<{ apiKeyId: string | null; response: NextResponse | null }> {
  if (!tool.require_api_key) return { apiKeyId: null, response: null };

  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) {
    return {
      apiKeyId: null,
      response: NextResponse.json({ error: "A valid bearer API key is required." }, { status: 401 }),
    };
  }

  const supabase = createAdminClient();
  const { data: apiKey } = await supabase
    .from("api_keys")
    .select("id, key_hash, revoked_at")
    .eq("workspace_id", tool.workspace_id)
    .eq("key_prefix", token.slice(0, 24))
    .maybeSingle();

  const tokenHash = createHash("sha256").update(token).digest();
  const storedHash = apiKey ? Buffer.from(apiKey.key_hash, "hex") : Buffer.alloc(0);
  const validHash = storedHash.length === tokenHash.length && timingSafeEqual(storedHash, tokenHash);
  if (!apiKey || apiKey.revoked_at || !validHash) {
    return {
      apiKeyId: null,
      response: NextResponse.json({ error: "A valid bearer API key is required." }, { status: 401 }),
    };
  }

  return { apiKeyId: apiKey.id, response: null };
}

export async function enforceWorkspaceQuota(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  apiKeyId: string | null
): Promise<NextResponse | null> {
  const { data: usage, error } = await supabase.rpc("consume_gateway_call", {
    target_workspace_id: workspaceId,
    target_api_key_id: apiKeyId,
  });
  if (error || usage === null) {
    console.error("MockAgent: workspace usage check failed", error?.message);
    return NextResponse.json({ error: "Workspace usage could not be checked." }, { status: 503 });
  }
  if (usage < 0) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    const retryAfter = Math.max(1, Math.ceil((nextMonth.getTime() - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Monthly workspace or API key call limit reached." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }
  return null;
}

export async function enforceClientRateLimit(request: NextRequest): Promise<NextResponse | null> {
  if (!isGatewayRateLimitConfigured()) {
    return process.env.NODE_ENV === "production" ? rateLimitUnavailable() : null;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIp =
    forwardedFor?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  try {
    const result = await checkGatewayRateLimit("client", clientIp);
    return result.success ? null : rateLimitExceeded(result);
  } catch (error) {
    console.error("MockAgent: gateway client rate-limit check failed", error);
    return rateLimitUnavailable();
  }
}

export async function enforceToolRateLimit(toolId: string): Promise<NextResponse | null> {
  try {
    const result = await checkGatewayRateLimit("tool", toolId);
    return result.success ? null : rateLimitExceeded(result);
  } catch (error) {
    console.error("MockAgent: gateway tool rate-limit check failed", error);
    return rateLimitUnavailable();
  }
}

function rateLimitUnavailable() {
  return NextResponse.json(
    { error: "Gateway rate limiting is unavailable." },
    { status: 503, headers: { "Retry-After": "30" } }
  );
}

function rateLimitExceeded(result: Awaited<ReturnType<typeof checkGatewayRateLimit>>) {
  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Rate limit exceeded. Retry later.", retry_after_seconds: retryAfter },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
      },
    }
  );
}