"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard", icon: "◎" },
  { href: "/tasks", label: "Tasks", icon: "≫" },
  { href: "/assets", label: "Assets", icon: "▤" },
  { href: "/findings", label: "Findings", icon: "◆" },
  { href: "/traffic", label: "Traffic", icon: "⇄" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function Nav({ username }: { username: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-4 border-r border-slate-800 bg-[#080d18] p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-600/20 text-cyan-300">⛓</span>
          <div>
            <div className="text-sm font-semibold text-slate-100">AegisMind</div>
            <div className="text-[10px] uppercase tracking-widest text-slate-500">Next.js edition</div>
          </div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="nav-link" data-active={isActive(link.href)}>
            <span className="w-4 text-center opacity-70">{link.icon}</span>
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto space-y-2 border-t border-slate-800 pt-3">
        <div className="text-[11px] text-slate-500">
          Signed in as <span className="text-slate-300">{username}</span>
        </div>
        <button
          className="btn w-full"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            router.push("/login");
            router.refresh();
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
