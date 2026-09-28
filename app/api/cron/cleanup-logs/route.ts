import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron authentication is not configured." }, { status: 503 });
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: deletedCount, error } = await supabase.rpc("delete_expired_logs");
  if (error) {
    console.error("MockAgent: expired log cleanup failed", error.message);
    return NextResponse.json({ error: "Log cleanup failed." }, { status: 500 });
  }

  return NextResponse.json({ deleted_logs: deletedCount ?? 0 });
}