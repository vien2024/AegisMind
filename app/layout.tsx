import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "AegisMind — Next.js edition",
  description:
    "LLM multi-agent task system with live-only model execution and approval-gated workspace commands.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <Script id="theme-boot" strategy="beforeInteractive">
          {THEME_BOOT_SCRIPT}
        </Script>
      </body>
    </html>
  );
}
