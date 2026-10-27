import { NextResponse } from "next/server";
import type { createAdminClient } from "@/lib/supabase/server";
import { checkGatewayRateLimit, isGatewayRateLimitConfigured } from "@/lib/rate-limit";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function enforceAIRequestBudget(
  supabase: AdminClient,
  workspaceId: string
): Promise<{ response: NextResponse; used: null } | { response: null; used: number }> {
  if (!isGatewayRateLimitConfigured()) {
    if (process.env.NODE_ENV === "production") {
      return {
        response: NextResponse.json(
          {
            error_code: "RATE_LIMITER_UNAVAILABLE",
            error: "AI rate limiting is unavailable.",
            retryable: true,
          },
          { status: 503, headers: { "Retry-After": "30" } }
        ),
        used: null,
      };
    }
  } else {
    try {
      const rateLimit = await checkGatewayRateLimit("model", workspaceId);
      if (!rateLimit.success) {
        const retryAfter = Math.max(1, Math.ceil((rateLimit.reset - Date.now()) / 1000));
        return {
          response: NextResponse.json(
            {
              error_code: "AI_RATE_LIMIT_EXCEEDED",
              error: "This workspace has reached the AI request rate limit. Retry later.",
              retryable: true,
              retry_after_seconds: retryAfter,
            },
            { status: 429, headers: { "Retry-After": String(retryAfter) } }
          ),
          used: null,
        };
      }
    } catch (error) {
      console.error("MockAgent: AI workspace rate-limit check failed", error);
      return {
        response: NextResponse.json(
          {
            error_code: "RATE_LIMITER_UNAVAILABLE",
            error: "AI rate limiting is unavailable.",
            retryable: true,
          },
          { status: 503, headers: { "Retry-After": "30" } }
        ),
        used: null,
      };
    }
  }

  const { data: used, error } = await supabase.rpc("consume_ai_request", {
    target_workspace_id: workspaceId,
  });
  if (error || typeof used !== "number") {
    console.error("MockAgent: AI workspace usage check failed", error?.message);
    return {
      response: NextResponse.json(
        {
          error_code: "AI_USAGE_UNAVAILABLE",
          error: "AI usage could not be checked. Ensure the latest schema.sql has been applied.",
          retryable: true,
        },
        { status: 503 }
      ),
      used: null,
    };
  }
  if (used === -1) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    const retryAfter = Math.max(1, Math.ceil((nextMonth.getTime() - Date.now()) / 1000));
    return {
      response: NextResponse.json(
        {
          error_code: "AI_MONTHLY_QUOTA_EXCEEDED",
          error: "This workspace has reached its monthly AI request limit.",
          retryable: true,
          retry_after_seconds: retryAfter,
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      ),
      used: null,
    };
  }
  if (used < 1) {
    console.error("MockAgent: AI usage check returned an invalid counter", used);
    return {
      response: NextResponse.json(
        { error_code: "AI_USAGE_UNAVAILABLE", error: "AI usage could not be checked.", retryable: true },
        { status: 503 }
      ),
      used: null,
    };
  }

  return { response: null, used };
}
