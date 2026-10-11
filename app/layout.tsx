import type { Metadata } from "next";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/components/shell/theme-toggle";

export const metadata: Metadata = {
  title: "AegisMind — Next.js edition",
  description:
    "LLM multi-agent exploration system. Local, offline edition with a Next.js frontend and backend and Vercel AI SDK agent workflows.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
