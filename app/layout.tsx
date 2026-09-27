import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MockAgent — Tool Mocking & Schema Validation for AI Agents",
  description:
    "Create virtual tool endpoints, validate agent tool-call JSON schemas, and track execution trajectories.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
