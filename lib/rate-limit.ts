import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const hasUpstashCredentials = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

const redis = hasUpstashCredentials ? Redis.fromEnv() : null;

const clientLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, "1 m"),
      prefix: "mockagent:gateway:client",
    })
  : null;

const toolLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(120, "1 m"),
      prefix: "mockagent:gateway:tool",
    })
  : null;

export function isGatewayRateLimitConfigured() {
  return clientLimiter !== null && toolLimiter !== null;
}

export async function checkGatewayRateLimit(scope: "client" | "tool", key: string) {
  const limiter = scope === "client" ? clientLimiter : toolLimiter;
  if (!limiter) {
    throw new Error("Gateway rate limiting is not configured.");
  }

  return limiter.limit(key);
}