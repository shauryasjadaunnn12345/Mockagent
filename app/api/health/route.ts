import { NextResponse } from "next/server";
import { probeGatewayRedis } from "@/lib/rate-limit";
import { getMetaConfig } from "@/lib/meta-ai";

export const runtime = "nodejs";

export async function GET() {
  const meta = getMetaConfig();
  let redis = "not_configured";
  try {
    redis = await probeGatewayRedis();
  } catch (error) {
    console.error("MockAgent health: Redis probe failed", error);
    redis = "error";
  }

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? "0.1.0",
    services: {
      redis,
      meta_ai: meta.configured ? `configured:${meta.provider}:${meta.model}` : "not_configured",
      supabase: process.env.NEXT_PUBLIC_SUPABASE_URL ? "configured" : "missing",
    }
  });
}
