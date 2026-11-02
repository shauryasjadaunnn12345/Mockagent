import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMetaConfig, listMetaModels } from "@/lib/meta-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to view available Meta models." }, { status: 401 });
  }

  const config = getMetaConfig();
  if (!config.configured) {
    return NextResponse.json({ error: "Meta AI is not configured." }, { status: 503 });
  }
  try {
    const models = await listMetaModels(AbortSignal.timeout(10_000));
    return NextResponse.json({
      provider: config.provider,
      defaultModel: config.model,
      models,
    }, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (error) {
    console.error("MockAgent Meta model catalog: request failed", error);
    return NextResponse.json({ error: "Could not load the Meta model catalog." }, { status: 502 });
  }
}
