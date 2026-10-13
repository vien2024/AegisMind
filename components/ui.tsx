import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/shell/icons";

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

const SEVERITY_TONE: Record<string, string> = {
  critical: "badge-critical",
  high: "badge-high",
  medium: "badge-medium",
  low: "badge-low",
  info: "badge-info",
};

const STATUS_TONE: Record<string, string> = {
  running: "badge-running",
  paused: "badge-paused",
  pending: "badge-pending",
  potential: "badge-pending",
  awaiting_approval: "badge-violet",
  blocked: "badge-failed",
  completed: "badge-completed",
  done: "badge-completed",
  fixed: "badge-fixed",
  confirmed: "badge-confirmed",
  failed: "badge-failed",
  stopped: "badge-stopped",
  open: "badge-pending",
  approved: "badge-fixed",
  auto_approved: "badge-neutral",
  denied: "badge-failed",
};

export function Badge({ tone, children, className = "" }: { tone?: string; children: ReactNode; className?: string }) {
  const cls = (tone && (SEVERITY_TONE[tone] ?? STATUS_TONE[tone])) ?? "badge-neutral";
  return <span className={`badge ${cls} ${className}`}>{children}</span>;
}

export function SeverityBadge({ severity, className = "" }: { severity: string; className?: string }) {
  return (
    <Badge tone={severity} className={className}>
      {severity}
    </Badge>
  );
}

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  return (
    <Badge tone={status} className={className}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

export function Card({
  title,
  icon,
  subtitle,
  action,
  children,
  padded = true,
  className = "",
}: {
  title?: ReactNode;
  icon?: IconName;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-header">
          <div className="min-w-0">
            <h2 className="card-title">
              {icon && <Icon name={icon} className="h-4 w-4 text-muted" />}
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 truncate text-[11px] text-faint">{subtitle}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={padded ? "card-body" : ""}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  icon,
  value,
  hint,
  children,
}: {
  label: string;
  icon?: IconName;
  value: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        {icon && <Icon name={icon} className="h-3.5 w-3.5" />}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold leading-none tracking-tight text-ink">{value}</div>
      {hint && <div className="mt-2 text-[11px] text-faint">{hint}</div>}
      {children}
    </div>
  );
}

export function Empty({ children, icon = "inbox" }: { children: ReactNode; icon?: IconName }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center text-xs text-faint">
      <Icon name={icon} className="h-5 w-5" />
      {children}
    </div>
  );
}

export function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function LinkTab({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Link href={href} className="chip" data-active={active ? "true" : "false"}>
      {children}
    </Link>
  );
}

export function Bar({ value, max, tone = "bg-ink" }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-subtle">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export { Icon };
export type { IconName };
