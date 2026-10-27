import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every request so that Server
 * Components always see a valid (non-expired) session. Called from the
 * root middleware.ts.
 */
export async function updateSession(request: NextRequest) {
  let cookiesToSet: Array<{
    name: string;
    value: string;
    options: Parameters<NextResponse["cookies"]["set"]>[2];
  }> = [];
  let responseHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(updatedCookies, headers) {
          updatedCookies.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet = updatedCookies;
          responseHeaders = headers;
        },
      },
    }
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const staleAuthCookieNames =
    error?.code === "refresh_token_not_found"
      ? request.cookies
          .getAll()
          .map(({ name }) => name)
          .filter((name) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name))
      : [];

  staleAuthCookieNames.forEach((name) => request.cookies.delete(name));

  // Protect the dashboard: bounce unauthenticated users to /login.
  const isDashboardRoute = request.nextUrl.pathname.startsWith("/dashboard");
  let response: NextResponse;
  if (isDashboardRoute && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    response = NextResponse.redirect(redirectUrl);
  } else {
    response = NextResponse.next({ request: { headers: request.headers } });
  }

  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  Object.entries(responseHeaders).forEach(([name, value]) => {
    response.headers.set(name, value);
  });
  staleAuthCookieNames.forEach((name) => {
    response.cookies.set(name, "", { maxAge: 0, path: "/" });
  });

  return response;
}
