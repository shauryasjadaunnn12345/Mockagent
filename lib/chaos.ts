export interface ChaosConfig { latencyMs?: number; failureRate?: number; }
export function parseChaosConfig(v: unknown): ChaosConfig | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const config = v as Record<string, unknown>;
  const latencyMs = config.latencyMs;
  const failureRate = config.failureRate;
  if (latencyMs !== undefined && (
    typeof latencyMs !== "number" || !Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > 5000
  )) return null;
  if (failureRate !== undefined && (
    typeof failureRate !== "number" || !Number.isFinite(failureRate) || failureRate < 0 || failureRate > 1
  )) return null;
  return {
    ...(latencyMs === undefined ? {} : { latencyMs }),
    ...(failureRate === undefined ? {} : { failureRate }),
  };
}
export async function applyChaos(c: ChaosConfig | null) {
  if (!c) return null;
  if (c.latencyMs) await new Promise(r=>setTimeout(r, c.latencyMs));
  if (c.failureRate && Math.random() < c.failureRate) return { injected: true };
  return null;
}
