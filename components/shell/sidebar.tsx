"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/shell/icons";
import { NAV_GROUPS } from "@/components/shell/nav-items";

export function Sidebar({
  collapsed,
  username,
  pendingApprovals,
  language,
  onLanguageChange,
}: {
  collapsed: boolean;
  username: string;
  pendingApprovals: number;
  language: string;
  onLanguageChange: (value: string) => void;
}) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside
      className="shrink-0 overflow-hidden border-r border-border bg-sidebar transition-[width] duration-200"
      style={{ width: collapsed ? 0 : 244 }}
    >
      <div className="flex h-screen w-[244px] flex-col">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-[11px] font-bold text-accentfg">
            AM
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-ink">AegisMind</span>
        </div>

        <nav className="scroll flex-1 overflow-y-auto px-2 pb-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="nav-item"
                  data-active={isActive(item.href) ? "true" : "false"}
                  title={item.label}
                >
                  <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                  {item.href === "/approval-records" && pendingApprovals > 0 && (
                    <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="space-y-2 border-t border-border p-3">
          <div className="relative flex items-center gap-1.5 rounded-lg border border-border bg-panel px-2 py-1.5">
            <Icon name="globe" className="h-3.5 w-3.5 text-muted" />
            <select
              aria-label="Language"
              value={language}
              onChange={(event) => onLanguageChange(event.target.value)}
              className="border-0! bg-transparent! p-0! text-[12px]! shadow-none! focus:!shadow-none"
            >
              <option value="en">English</option>
              <option value="ko">한국어</option>
            </select>
          </div>
          <div className="flex items-center gap-2 px-1 py-1">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-hover text-[11px] font-semibold uppercase text-ink">
              {username.slice(0, 1)}
            </span>
            <span className="truncate text-[12px] font-medium text-ink">{username}</span>
            <Icon name="more" className="ml-auto h-4 w-4 text-faint" />
          </div>
        </div>
      </div>
    </aside>
  );
}
