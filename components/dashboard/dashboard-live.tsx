"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TokenUsageCard } from "@/components/dashboard/token-usage-card";
import { Icon } from "@/components/shell/icons";
import { Badge, Empty, SectionHeading, SeverityBadge } from "@/components/ui";
import type { OverviewPayload } from "@/lib/overview";

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function ago(iso: string): string {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const ROLE_TONE: Record<string, string> = {
  planner: "badge-violet",
  engine: "badge-neutral",
  system: "badge-neutral",
};

function RoleChip({ role }: { role: string }) {
  const tone = role.startsWith("worker") ? "badge-low" : (ROLE_TONE[role] ?? "badge-neutral");
  return <span className={`badge ${tone}`}>{role}</span>;
}

export function DashboardLive({
  initial,
  usageInitial,
  live,
}: {
  initial: OverviewPayload;
  usageInitial: React.ComponentProps<typeof TokenUsageCard>["initial"];
  live: boolean;
}) {
  const [data, setData] = useState(initial);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      const response = await fetch("/api/overview", { cache: "no-store" });
      if (response.ok) setData((await response.json()) as OverviewPayload);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of data.activity) counts[entry.type] = (counts[entry.type] ?? 0) + 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [data.activity]);

  const activity = typeFilter ? data.activity.filter((entry) => entry.type === typeFilter) : data.activity;
  const severityOrder = ["critical", "high", "medium", "low"];

  return (
    <>
      <SectionHeading title="Overview" subtitle="Global system status · Refreshes live" />

      {!live && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-subtle px-3 py-2 text-[11px] text-muted">
          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong className="font-semibold text-ink">Offline simulator mode.</strong> No LLM provider is
            configured, so planner and worker agents run against a deterministic local model and all
            reconnaissance is simulated. Add an OpenAI or Anthropic key under{" "}
            <Link href="/llm" className="text-link underline">
              LLM
            </Link>{" "}
            to run live agent workflows.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <Icon name="activity" className="h-3.5 w-3.5" />
            Active tasks
          </div>
          <div className="mt-2 text-2xl font-semibold leading-none tracking-tight text-ink">
            {data.tasks.running + data.tasks.paused} / {data.tasks.total}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
            <span className="flex items-center gap-1 text-blue-600">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> Exploring {data.tasks.running}
            </span>
            <span className="flex items-center gap-1 text-amber-600">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Paused {data.tasks.paused}
            </span>
            <span className="flex items-center gap-1 text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Completed {data.tasks.completed}
            </span>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <Icon name="bug" className="h-3.5 w-3.5" />
            Confirmed findings
          </div>
          <div className="mt-2 text-2xl font-semibold leading-none tracking-tight text-ink">
            {data.findings.confirmed}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
            {severityOrder.map((severity) => (
              <span key={severity} className="flex items-center gap-1 capitalize text-muted">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background:
                      severity === "critical"
                        ? "#dc2626"
                        : severity === "high"
                          ? "#ea580c"
                          : severity === "medium"
                            ? "#d97706"
                            : "#2563eb",
                  }}
                />
                {severity} {data.findings.bySeverity[severity] ?? 0}
              </span>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <Icon name="box" className="h-3.5 w-3.5" />
            Asset nodes
          </div>
          <div className="mt-2 text-2xl font-semibold leading-none tracking-tight text-ink">{data.assets.total}</div>
          <div className="mt-2 text-[11px] text-faint">Shared across tasks</div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <Icon name="activity" className="h-3.5 w-3.5" />
            Traffic interactions
          </div>
          <div className="mt-2 text-2xl font-semibold leading-none tracking-tight text-ink">{data.traffic.total}</div>
          <div className="mt-2 flex items-center gap-1 text-[11px] text-faint">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> {live ? "Recording" : "Simulated"}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-1.5 text-[11px] text-muted">
            <Icon name="sparkles" className="h-3.5 w-3.5" />
            Token usage
          </div>
          <div className="mt-2 text-2xl font-semibold leading-none tracking-tight text-ink">
            {compact(data.usage.total)}
          </div>
          <div className="mt-2 text-[11px] text-faint">
            In {compact(data.usage.input + data.usage.cacheRead)} (including cache {compact(data.usage.cacheRead)})
            {" · "}Out {compact(data.usage.output)}
          </div>
        </div>
      </div>

      <TokenUsageCard initial={usageInitial} />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <header className="card-header">
            <h2 className="card-title">
              <Icon name="activity" className="h-4 w-4 text-muted" />
              Activity feed
            </h2>
            <div className="flex items-center gap-2 text-[11px] text-faint">
              <span>{data.activity.length} events</span>
              <Link href="/logs" className="inline-flex items-center gap-1 hover:text-ink">
                View tasks <Icon name="chevronRight" className="h-3 w-3" />
              </Link>
            </div>
          </header>
          <div className="card-body space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="chip" data-active={typeFilter === null ? "true" : "false"} onClick={() => setTypeFilter(null)}>
                All
              </button>
              {typeCounts.map(([type, count]) => (
                <button
                  key={type}
                  type="button"
                  className="chip"
                  data-active={typeFilter === type ? "true" : "false"}
                  onClick={() => setTypeFilter(type)}
                >
                  {type} <span className="text-[10px] opacity-70">{count}</span>
                </button>
              ))}
            </div>

            {activity.length === 0 ? (
              <Empty>No activity recorded yet — start a task to see planner wakes and worker steps.</Empty>
            ) : (
              <ul className="max-h-[26rem] space-y-1.5 overflow-y-auto scroll pr-1">
                {activity.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-start gap-2 rounded-lg border border-border bg-subtle px-2.5 py-2"
                  >
                    <RoleChip role={entry.role} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-ink">{entry.title}</div>
                      {entry.content && (
                        <div className="truncate text-[11px] text-faint">{entry.content}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="badge badge-neutral">{entry.type}</span>
                      <span className="w-14 text-right text-[10px] text-faint">{ago(entry.created_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="card">
          <header className="card-header">
            <h2 className="card-title">
              <Icon name="bug" className="h-4 w-4 text-muted" />
              Findings
            </h2>
            <Link href="/findings" className="inline-flex items-center gap-1 text-[11px] text-faint hover:text-ink">
              All <Icon name="chevronRight" className="h-3 w-3" />
            </Link>
          </header>
          <div className="card-body">
            {data.findings.recent.length === 0 ? (
              <Empty>No findings recorded yet.</Empty>
            ) : (
              <ul className="space-y-3">
                {data.findings.recent.map((finding) => (
                  <li key={finding.id} className="flex gap-2">
                    <SeverityBadge severity={finding.severity} className="mt-0.5 shrink-0 capitalize" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12px] font-medium text-ink">{finding.title}</span>
                        <span className="shrink-0 text-[10px] text-faint">{ago(finding.created_at)}</span>
                      </div>
                      <div className="truncate text-[11px] text-muted">
                        {finding.task_name ?? "manual"} {finding.description ? `· ${finding.description}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

export { Badge };
