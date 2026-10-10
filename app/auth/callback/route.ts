import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = searchParams.get("type");
  const next = searchParams.get("next");
  const redirectPath = next === "/reset-password" ? next : "/dashboard";
  const authError = searchParams.get("error_description") ?? searchParams.get("error");

  const redirectWithError = (message: string) => {
    const errorPath = redirectPath === "/reset-password" ? "/forgot-password" : "/login";
    return NextResponse.redirect(
      `${origin}${errorPath}?error=${encodeURIComponent(message)}`
    );
  };

  if (authError) {
    return redirectWithError(authError);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return redirectWithError(error.message);
    }
  } else if (tokenHash && otpType) {
    if (redirectPath === "/reset-password" && otpType !== "recovery") {
      return redirectWithError("Invalid password reset link.");
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });

    if (error) {
      return redirectWithError(error.message);
    }
  }

  return NextResponse.redirect(`${origin}${redirectPath}`);
}
