import assert from "node:assert/strict";
import test from "node:test";
import { validateDeploymentConfig } from "./deployment-config.mjs";

const validDevelopmentConfig = {
  NODE_ENV: "development",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  SEMANTIC_JUDGE_BASE_URL: "https://inference.baseten.co/v1",
  SEMANTIC_JUDGE_API_KEY: "test-baseten-key",
  SEMANTIC_JUDGE_MODEL: "meta-models/muse-spark-open-1026",
};

test("accepts a complete development configuration with optional billing disabled", () => {
  const result = validateDeploymentConfig(validDevelopmentConfig);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((warning) => warning.includes("Dodo billing is not configured")));
});

test("rejects incomplete or insecure production configuration", () => {
  const result = validateDeploymentConfig({
    ...validDevelopmentConfig,
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: "http://mockagent.example",
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
    CRON_SECRET: "",
  });
  assert.ok(result.errors.some((error) => error.includes("NEXT_PUBLIC_APP_URL")));
  assert.ok(result.errors.some((error) => error.includes("Upstash")));
  assert.ok(result.errors.some((error) => error.includes("CRON_SECRET")));
});

test("requires the exact hackathon model when a Baseten key is set", () => {
  const result = validateDeploymentConfig({
    ...validDevelopmentConfig,
    SEMANTIC_JUDGE_MODEL: "meta-models/muse-spark-open",
  });
  assert.ok(result.errors.some((error) => error.includes("meta-models/muse-spark-open-1026")));
});

test("requires complete Dodo configuration instead of silently enabling partial billing", () => {
  const result = validateDeploymentConfig({
    ...validDevelopmentConfig,
    DODO_PAYMENTS_API_KEY: "test-dodo-key",
    DODO_PAYMENTS_ENVIRONMENT: "test_mode",
  });
  assert.ok(result.errors.some((error) => error.includes("both Solo and Team product IDs")));
});

test("accepts complete production configuration without exposing any credentials", () => {
  const result = validateDeploymentConfig({
    ...validDevelopmentConfig,
    NODE_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://mockagent.example",
    UPSTASH_REDIS_REST_URL: "https://redis.example",
    UPSTASH_REDIS_REST_TOKEN: "test-redis-token",
    CRON_SECRET: "x".repeat(32),
    DODO_PAYMENTS_API_KEY: "test-dodo-api",
    DODO_PAYMENTS_WEBHOOK_KEY: "test-dodo-webhook",
    DODO_PAYMENTS_SOLO_PRODUCT_ID: "test-solo-product",
    DODO_PAYMENTS_TEAM_PRODUCT_ID: "test-team-product",
    DODO_PAYMENTS_ENVIRONMENT: "test_mode",
  });
  assert.deepEqual(result.errors, []);
});
