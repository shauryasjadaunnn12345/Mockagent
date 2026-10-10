import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { resetPassword } from "@/app/actions/auth";

export const metadata: Metadata = {
  title: "Create a new password",
  alternates: {
    canonical: "/reset-password",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; code?: string; token_hash?: string }>;
}) {
  const { error, code, token_hash } = await searchParams;
  const recoveryCode = code ?? token_hash;
  let resetLinkMessage = "";

  if (recoveryCode) {
    try {
      const supabase = await createClient();
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(recoveryCode);

      if (exchangeError) {
        resetLinkMessage = exchangeError.message;
      }
    } catch {
      resetLinkMessage = "Something went wrong while validating your reset link.";
    }
  }

  if (resetLinkMessage) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center text-xl font-bold text-slate-900">
              {resetLinkMessage === "Something went wrong while validating your reset link." ? "Unable to continue" : "Reset link expired"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-red-600">{resetLinkMessage}</p>
            <Link href="/forgot-password" className="inline-flex text-sm font-medium text-[#286449] hover:text-[#17362a]">
              Request a new reset link
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <Link href="/login" className="mb-6 text-sm font-medium text-slate-500 transition hover:text-slate-900">
        ← Back to log in
      </Link>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-xl font-bold text-slate-900">Set a new password</CardTitle>
          <p className="text-center text-sm text-slate-500">Choose a strong password to finish resetting your account.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="rounded-md bg-red-50 p-2 text-sm text-red-600">{error}</p>
          )}

          <form action={resetPassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
            </div>
            <Button type="submit" className="w-full">
              Update password
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
