import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

/**
 * Supabase client for use in Server Components, Server Actions, and Route Handlers.
 * Uses the request's cookie jar to read/write the auth session.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database, "public">(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component — safe to ignore because
            // middleware.ts already refreshes the session on every request.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // Same as above — ignorable in a Server Component context.
          }
        },
      },
    }
  );
}

/**
 * Admin client using the SERVICE ROLE key. Bypasses RLS.
 * ONLY use this server-side for trusted system operations — e.g. the public
 * mock gateway route, which writes logs on behalf of external callers who
 * are not authenticated Supabase users themselves.
 *
 * NEVER import this file into a Client Component and never send this key
 * to the browser.
 */
export function createAdminClient() {
  return createServerClient<Database, "public">(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        get() {
          return undefined;
        },
        set() {
          /* no-op: admin client is not session-bound */
        },
        remove() {
          /* no-op */
        },
      },
    }
  );
}
