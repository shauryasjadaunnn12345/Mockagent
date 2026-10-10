import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { forgotPassword } from "@/app/actions/auth";

export const metadata: Metadata = {
  title: "Reset your password",
  alternates: {
    canonical: "/forgot-password",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <Link href="/login" className="mb-6 text-sm font-medium text-slate-500 transition hover:text-slate-900">
        ← Back to log in
      </Link>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-xl font-bold text-slate-900">Forgot your password?</CardTitle>
          <p className="text-center text-sm text-slate-500">
            Enter your email and we&apos;ll send you a secure reset link.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="rounded-md bg-red-50 p-2 text-sm text-red-600">{error}</p>
          )}

          <form action={forgotPassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required placeholder="you@example.com" />
            </div>
            <Button type="submit" className="w-full">
              Send reset link
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
