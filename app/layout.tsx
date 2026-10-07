import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://mockagent.online"),
  title: {
    default: "MockAgent | AI Agent Tool Mocking & Testing",
    template: "%s | MockAgent",
  },
  description:
    "MockAgent lets you mock AI agent tools, validate tool-call JSON with JSON Schema, test edge cases, and inspect execution logs before connecting real services.",
  applicationName: "MockAgent",
  keywords: [
    "AI agent testing",
    "AI tool mocking",
    "mock API endpoints",
    "JSON Schema validation",
    "agent tool calls",
    "AI agent development",
  ],
  authors: [{ name: "MockAgent", url: "https://mockagent.online" }],
  creator: "MockAgent",
  publisher: "MockAgent",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://mockagent.online/",
    siteName: "MockAgent",
    title: "MockAgent | AI Agent Tool Mocking & Testing",
    description:
      "Mock AI agent tools, validate JSON Schema, test edge cases, and inspect execution logs before connecting real services.",
  },
  twitter: {
    card: "summary_large_image",
    title: "MockAgent | AI Agent Tool Mocking & Testing",
    description:
      "Mock AI agent tools, validate JSON Schema, test edge cases, and inspect execution logs before connecting real services.",
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
