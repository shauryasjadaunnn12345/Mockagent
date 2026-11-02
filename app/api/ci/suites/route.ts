import { NextResponse, type NextRequest } from "next/server";
import { parseRegressionTestCases } from "@/lib/regression-suites";
import { createAdminClient } from "@/lib/supabase/server";
import {
  readWorkspaceBearerToken,
  resolveWorkspaceApiKey,
} from "@/lib/workspace-api-key";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = readWorkspaceBearerToken(request.headers.get("authorization"));
  if (!token) {
    return NextResponse.json({ error: "A valid workspace bearer API key is required." }, { status: 401 });
  }

  let credentials;
  try {
    credentials = await resolveWorkspaceApiKey(token);
  } catch {
    return NextResponse.json({ error: "Could not validate workspace credentials." }, { status: 503 });
  }
  if (!credentials) {
    return NextResponse.json({ error: "Workspace API key is invalid or revoked." }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: suites, error } = await supabase
    .from("agent_test_suites")
    .select("id,name,test_cases,prompt")
    .eq("workspace_id", credentials.workspaceId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("MockAgent CI: failed to list regression suites", error.message);
    return NextResponse.json({ error: "Could not load workspace regression suites." }, { status: 500 });
  }

  try {
    const result = (suites ?? []).map((suite) => ({
      id: suite.id,
      name: suite.name,
      caseCount: parseRegressionTestCases(suite.test_cases, suite.prompt).length,
    }));
    return NextResponse.json({ suites: result });
  } catch (error) {
    console.error("MockAgent CI: invalid saved regression suite", error);
    return NextResponse.json({ error: "A saved regression suite has invalid test cases." }, { status: 500 });
  }
}
