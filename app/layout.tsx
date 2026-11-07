import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://mockagent.online"),
  title: {
    default: "MockAgent | AI Agent Tool Mocking, MCP & Testing",
    template: "%s | MockAgent",
  },
  description:
    "Mock AI agent tools, connect over MCP, import OpenAPI or HAR captures, test edge cases, and run repeatable regression suites with GitHub Actions.",
  applicationName: "MockAgent",
  keywords: [
    "AI agent testing",
    "AI tool mocking",
    "MCP server",
    "AI agent regression testing",
    "OpenAPI mock import",
    "HAR traffic import",
    "GitHub Actions agent tests",
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
    title: "MockAgent | AI Agent Tool Mocking, MCP & Testing",
    description:
      "Build mock tools, connect agents over MCP, import definitions or HAR captures, and run repeatable regression tests.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "MockAgent AI agent tool testing" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MockAgent | AI Agent Tool Mocking, MCP & Testing",
    description:
      "Build mock tools, connect agents over MCP, import definitions or HAR captures, and run repeatable regression tests.",
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
