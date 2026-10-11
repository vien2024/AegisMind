"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Icon } from "@/components/shell/icons";
import { Badge, Empty, SectionHeading, SeverityBadge, StatusBadge } from "@/components/ui";
import type { Finding } from "@/lib/types";

type Row = Finding & { task_name: string | null; asset_value: string | null };

const STATUS_OPTIONS = ["pending", "confirmed", "fixed", "false_positive", "accepted"];
const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function ago(iso: string): string {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function FindingsClient({
  findings,
  bySeverity,
}: {
  findings: Row[];
  bySeverity: Record<string, number>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<string | null>(null);
  const [status, setStatus] = useState("all");
  const [task, setTask] = useState("all");
  const [sort, setSort] = useState("severity");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const tasks = useMemo(() => {
    const map = new Map<number, string>();
    for (const finding of findings) {
      if (finding.task_id) map.set(finding.task_id, finding.task_name ?? `#${finding.task_id}`);
    }
    return [...map.entries()];
  }, [findings]);

  const rows = useMemo(() => {
    const filtered = findings.filter((finding) => {
      if (severity && finding.severity !== severity) return false;
      if (status !== "all" && finding.status !== status) return false;
      if (task !== "all" && String(finding.task_id) !== task) return false;
      if (query) {
        const haystack = `${finding.title} ${finding.description ?? ""} ${finding.evidence ?? ""} ${finding.asset_value ?? ""}`.toLowerCase();
        if (!haystack.includes(query.toLowerCase())) return false;
      }
      return true;
    });
    return filtered.sort((a, b) =>
      sort === "severity"
        ? (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
        : sort === "recent"
          ? b.id - a.id
          : a.title.localeCompare(b.title),
    );
  }, [findings, severity, status, task, query, sort]);

  async function update(id: number, patch: Record<string, unknown>) {
    setBusy(id);
    await fetch(`/api/findings/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(null);
    router.refresh();
  }

  return (
    <>
      <SectionHeading
        title="Findings"
        subtitle="Vulnerability summary across tasks"
        action={
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {["All findings", "Group by task", "By asset"].map((label, index) => (
              <button
                key={label}
                type="button"
                className="border-l border-border px-2.5 py-1 text-[11px] first:border-l-0"
                style={index === 0 ? { background: "var(--hover)", color: "var(--ink)", fontWeight: 600 } : { color: "var(--muted)" }}
                onClick={() => setSort(index === 0 ? "recent" : index === 1 ? "task" : "title")}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <SummaryCard label="Total findings" value={findings.length} icon="bug" />
        <SummaryCard
          label="Pending"
          value={findings.filter((finding) => finding.status === "pending").length}
          icon="clock"
          tone="text-amber-600"
        />
        {(["critical", "high", "medium", "low"] as const).map((entry) => (
          <SummaryCard
            key={entry}
            label={entry[0]!.toUpperCase() + entry.slice(1)}
            value={bySeverity[entry] ?? 0}
            icon="alert"
            tone={
              entry === "critical"
                ? "text-red-600"
                : entry === "high"
                  ? "text-orange-600"
                  : entry === "medium"
                    ? "text-amber-600"
                    : "text-blue-600"
            }
          />
        ))}
      </div>

      <section className="card">
        <div className="card-body space-y-3">
          <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_auto_auto_auto]">
            <div className="relative">
              <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search vulnerability content"
                className="pl-8!"
              />
            </div>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="lg:w-40">
              <option value="all">All statuses</option>
              {STATUS_OPTIONS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <select value={task} onChange={(event) => setTask(event.target.value)} className="lg:w-48">
              <option value="all">All tasks</option>
              {tasks.map(([id, name]) => (
                <option key={id} value={String(id)}>
                  {name}
                </option>
              ))}
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value)} className="lg:w-40">
              <option value="severity">By severity</option>
              <option value="recent">Most recent</option>
              <option value="title">By name</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="chip" data-active={severity === null ? "true" : "false"} onClick={() => setSeverity(null)}>
                All
              </button>
              {SEVERITIES.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className="chip capitalize"
                  data-active={severity === entry ? "true" : "false"}
                  onClick={() => setSeverity(entry)}
                >
                  {entry}
                </button>
              ))}
            </div>
            <a className="btn" href="/api/findings/export" onClick={(event) => event.preventDefault()}>
              <Icon name="download" className="h-3.5 w-3.5" />
              Export
            </a>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 pb-4">
            <Empty>No findings match the current filters.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 32 }} />
                  <th>Severity</th>
                  <th>Vulnerability name</th>
                  <th>Assets</th>
                  <th>Status</th>
                  <th>Task</th>
                  <th>Time</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((finding) => (
                  <tr key={finding.id}>
                    <td>
                      <button
                        type="button"
                        className="icon-btn h-6! w-6!"
                        aria-label="Toggle details"
                        onClick={() => setExpanded(expanded === finding.id ? null : finding.id)}
                      >
                        <Icon name="chevronRight" className={`h-3.5 w-3.5 transition-transform ${expanded === finding.id ? "rotate-90" : ""}`} />
                      </button>
                    </td>
                    <td>
                      <SeverityBadge severity={finding.severity} className="capitalize" />
                    </td>
                    <td className="max-w-[420px]">
                      <div className="truncate text-[12.5px] font-medium text-ink">{finding.title}</div>
                      {finding.description && (
                        <div className="truncate text-[11px] text-muted">{finding.description}</div>
                      )}
                      <div className="mt-0.5 text-[10px] text-faint">
                        Traffic evidence {finding.evidence ? "1 record" : "0 records"}
                      </div>
                      {expanded === finding.id && finding.evidence && (
                        <pre className="mono mt-2 whitespace-pre-wrap rounded-md border border-border bg-subtle p-2 text-[10.5px] text-muted">
                          {finding.evidence}
                        </pre>
                      )}
                    </td>
                    <td>
                      <span className="mono text-[11px] text-muted">{finding.asset_value ?? "—"}</span>
                    </td>
                    <td>
                      <select
                        value={finding.status}
                        disabled={busy === finding.id}
                        onChange={(event) => update(finding.id, { status: event.target.value })}
                        className="w-36! py-1! text-[11px]!"
                      >
                        {STATUS_OPTIONS.map((entry) => (
                          <option key={entry} value={entry}>
                            {entry.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {finding.task_id ? (
                        <Link href={`/tasks/${finding.task_id}`} className="inline-flex items-center gap-1 text-[11px] text-link hover:underline">
                          {finding.task_name ?? `#${finding.task_id}`}
                          <Icon name="chevronRight" className="h-3 w-3" />
                        </Link>
                      ) : (
                        <Badge tone="info">manual</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-[11px] text-faint">{ago(finding.created_at)}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="btn px-2! py-1! text-[11px]!"
                          onClick={() => update(finding.id, { status: "confirmed" })}
                        >
                          <Icon name="checkCircle" className="h-3.5 w-3.5" />
                          Confirm
                        </button>
                        <button
                          type="button"
                          className="btn px-2! py-1! text-[11px]!"
                          onClick={() => setExpanded(expanded === finding.id ? null : finding.id)}
                        >
                          <Icon name="eye" className="h-3.5 w-3.5" />
                          Evidence
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  tone = "text-ink",
}: {
  label: string;
  value: number;
  icon: "bug" | "clock" | "alert";
  tone?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`mt-2 flex items-center gap-2 text-2xl font-semibold leading-none tracking-tight ${tone}`}>
        <Icon name={icon} className="h-4 w-4" />
        {value}
      </div>
    </div>
  );
}

export { StatusBadge };
