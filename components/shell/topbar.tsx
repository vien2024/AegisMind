"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/shell/icons";
import { ThemeToggle } from "@/components/shell/theme-toggle";

export function Topbar({
  username,
  onToggleSidebar,
}: {
  username: string;
  onToggleSidebar: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur">
      <button type="button" className="icon-btn" onClick={onToggleSidebar} aria-label="Toggle sidebar">
        <Icon name="panelLeft" className="h-4 w-4" />
      </button>

      <form
        className="relative max-w-sm flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (!query.trim()) return;
          router.push(`/search?q=${encodeURIComponent(query.trim())}`);
        }}
      >
        <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          className="pl-8! pr-12!"
          aria-label="Search tasks, assets and findings"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border px-1 text-[10px] text-faint">
          ⌘J
        </span>
      </form>

      <div className="ml-auto flex items-center gap-1.5">
        <Link href="/settings" className="icon-btn" title="System settings" aria-label="System settings">
          <Icon name="settings" className="h-4 w-4" />
        </Link>
        <ThemeToggle />
        <div className="relative">
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded-full border border-border bg-hover text-[11px] font-semibold uppercase text-ink"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Account menu"
          >
            {username.slice(0, 1)}
          </button>
          {menuOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-10 cursor-default"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 z-20 mt-2 w-48 rounded-lg border border-border bg-panel p-1 shadow-lg">
                <div className="px-2 py-1.5 text-[11px] text-muted">
                  Signed in as <span className="font-medium text-ink">{username}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost w-full justify-start!"
                  onClick={async () => {
                    await fetch("/api/auth/logout", { method: "POST" });
                    setMenuOpen(false);
                    router.push("/login");
                    router.refresh();
                  }}
                >
                  <Icon name="x" className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
