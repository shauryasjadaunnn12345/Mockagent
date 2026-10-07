import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  signInWithPassword,
  signUpWithPassword,
  signInWithGitHub,
} from "@/app/actions/auth";

export const metadata: Metadata = {
  title: "Sign in or create an account",
  alternates: {
    canonical: "/login",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; mode?: string }>;
}) {
  const { error, message, mode } = await searchParams;
  const signUpMode = mode === "signup";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <Link href="/" className="mb-6 text-sm font-medium text-slate-500 transition hover:text-slate-900">
        ← Back to MockAgent
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center text-xl font-bold text-slate-900">
            {signUpMode ? "Create your MockAgent account" : "Welcome back to MockAgent"}
          </CardTitle>
          <p className="text-center text-sm text-slate-500">
            {signUpMode
              ? "Start building and testing your agent tools"
              : "Sign in to manage your mock tool endpoints"}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="rounded-md bg-red-50 p-2 text-sm text-red-600">
              {error}
            </p>
          )}
          {message && (
            <p className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-700">
              {message}
            </p>
          )}

          <form action={signUpMode ? signUpWithPassword : signInWithPassword} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required placeholder="you@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="w-full">
                {signUpMode ? "Create account" : "Log in"}
              </Button>
              <Button
                formAction={signUpMode ? signInWithPassword : signUpWithPassword}
                variant="outline"
                className="w-full"
              >
                {signUpMode ? "Log in instead" : "Sign up"}
              </Button>
            </div>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-slate-400">or</span>
            </div>
          </div>

          <form action={signInWithGitHub}>
            <Button type="submit" variant="outline" className="w-full">
              Continue with GitHub
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
