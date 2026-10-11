"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

export function AppShell({
  username,
  pendingApprovals,
  language,
  children,
}: {
  username: string;
  pendingApprovals: number;
  language: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar
        collapsed={collapsed}
        username={username}
        pendingApprovals={pendingApprovals}
        language={language}
        onLanguageChange={async (value) => {
          await fetch("/api/settings", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ language: value }),
          });
          router.refresh();
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar username={username} onToggleSidebar={() => setCollapsed((value) => value!)} />
        <main className="scroll flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto w-full max-w-[1180px] space-y-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
