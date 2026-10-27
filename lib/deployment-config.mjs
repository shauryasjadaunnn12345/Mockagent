const HACKATHON_MODEL = "meta-models/muse-spark-open-1026";

function configured(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 && !/^your[-_]/i.test(normalized);
}

function validUrl(value, allowLocalHttp) {
  if (!configured(value)) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return url.protocol === "https:" ||
      (allowLocalHttp && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}

export function validateDeploymentConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  const production = env.NODE_ENV === "production";

  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_APP_URL",
  ]) {
    if (!configured(env[name])) errors.push(`${name} must be set.`);
  }
  if (configured(env.NEXT_PUBLIC_SUPABASE_URL) && !validUrl(env.NEXT_PUBLIC_SUPABASE_URL, !production)) {
    errors.push("NEXT_PUBLIC_SUPABASE_URL must be a valid HTTPS URL (localhost HTTP is allowed in development).");
  }
  if (configured(env.NEXT_PUBLIC_APP_URL) && !validUrl(env.NEXT_PUBLIC_APP_URL, !production)) {
    errors.push("NEXT_PUBLIC_APP_URL must be a valid HTTPS URL in production.");
  }

  const redisUrl = configured(env.UPSTASH_REDIS_REST_URL);
  const redisToken = configured(env.UPSTASH_REDIS_REST_TOKEN);
  if (redisUrl !== redisToken) errors.push("Set both Upstash Redis REST credentials or neither.");
  if (production && (!redisUrl || !redisToken)) {
    errors.push("Production requires both Upstash Redis credentials for gateway and AI rate limits.");
  }
  if (production && !configured(env.CRON_SECRET)) {
    errors.push("Production requires CRON_SECRET for scheduled log cleanup.");
  }
  if (production && configured(env.CRON_SECRET) && env.CRON_SECRET.trim().length < 32) {
    errors.push("CRON_SECRET must be at least 32 characters.");
  }

  if (configured(env.SEMANTIC_JUDGE_API_KEY)) {
    if (env.SEMANTIC_JUDGE_MODEL?.trim() !== HACKATHON_MODEL) {
      errors.push(`SEMANTIC_JUDGE_MODEL must be ${HACKATHON_MODEL} when using the Baseten hackathon key.`);
    }
    if (
      configured(env.SEMANTIC_JUDGE_BASE_URL) &&
      !validUrl(env.SEMANTIC_JUDGE_BASE_URL, !production)
    ) {
      errors.push("SEMANTIC_JUDGE_BASE_URL must use HTTPS (localhost HTTP is allowed in development).");
    }
  } else {
    warnings.push("Baseten AI features are unavailable until SEMANTIC_JUDGE_API_KEY is configured.");
  }

  const dodoNames = [
    "DODO_PAYMENTS_API_KEY",
    "DODO_PAYMENTS_WEBHOOK_KEY",
    "DODO_PAYMENTS_SOLO_PRODUCT_ID",
    "DODO_PAYMENTS_TEAM_PRODUCT_ID",
  ];
  const configuredDodoNames = dodoNames.filter((name) => configured(env[name]));
  if (configuredDodoNames.length > 0 && configuredDodoNames.length !== dodoNames.length) {
    errors.push("Dodo billing requires its API key, webhook key, and both Solo and Team product IDs.");
  }
  if (
    configuredDodoNames.length > 0 &&
    !["test_mode", "live_mode"].includes(env.DODO_PAYMENTS_ENVIRONMENT?.trim() ?? "")
  ) {
    errors.push("DODO_PAYMENTS_ENVIRONMENT must be test_mode or live_mode.");
  }
  if (configuredDodoNames.length === 0) {
    warnings.push("Dodo billing is not configured; paid-plan checkout and webhooks are unavailable.");
  }

  return { errors, warnings };
}
