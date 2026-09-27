import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

interface GatewayLimiters {
  client: Ratelimit;
  tool: Ratelimit;
}

let gatewayLimiters: GatewayLimiters | null = null;

function getEnvironmentValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return undefined;

  const hasWrappingQuotes =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));

  return hasWrappingQuotes ? value.slice(1, -1).trim() : value;
}

function getGatewayLimiters(): GatewayLimiters | null {
  if (gatewayLimiters) return gatewayLimiters;

  const url = getEnvironmentValue("UPSTASH_REDIS_REST_URL");
  const token = getEnvironmentValue("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) return null;

  const redis = new Redis({ url, token });
  gatewayLimiters = {
    client: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, "1 m"),
      prefix: "mockagent:gateway:client",
    }),
    tool: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(120, "1 m"),
      prefix: "mockagent:gateway:tool",
    }),
  };

  return gatewayLimiters;
}

export function isGatewayRateLimitConfigured() {
  return Boolean(
    getEnvironmentValue("UPSTASH_REDIS_REST_URL") &&
      getEnvironmentValue("UPSTASH_REDIS_REST_TOKEN")
  );
}

export async function checkGatewayRateLimit(scope: "client" | "tool", key: string) {
  const limiters = getGatewayLimiters();
  if (!limiters) {
    throw new Error("Gateway rate limiting is not configured.");
  }

  return limiters[scope].limit(key);
}