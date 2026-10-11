"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/shell/icons";

interface UsageBucket {
  bucket: string;
  input: number;
  output: number;
  cacheRead: number;
}

interface UsagePayload {
  range: "day" | "month";
  totals: {
    total: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    runs: number;
    tasks: number;
    cacheHitRate: number;
  };
  byModel: Array<{
    model: string;
    provider: string;
    live: number;
    runs: number;
    input: number;
    output: number;
    cacheRead: number;
    total: number;
  }>;
  series: UsageBucket[];
  model: string | null;
}

const RANGES = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "3m", label: "3 months" },
  { id: "6m", label: "6 months" },
  { id: "1y", label: "1 year" },
];

const COLORS = {
  input: "#3b82f6",
  output: "#8b5cf6",
  cacheRead: "#22c55e",
};

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function bucketLabel(bucket: string, range: "day" | "month"): string {
  if (range === "month") {
    const [year, month] = bucket.split("-");
    return `${month}/${String(year).slice(2)}`;
  }
  const [, month, day] = bucket.split("-");
  return `${month}-${day}`;
}

export function TokenUsageCard({ initial }: { initial: UsagePayload }) {
  const [data, setData] = useState<UsagePayload>(initial);
  const [range, setRange] = useState("3m");
  const [model, setModel] = useState<string | null>(null);
  const [view, setView] = useState<"totals" | "models">("totals");

  const load = useCallback(async (nextRange: string, nextModel: string | null) => {
    const params = new URLSearchParams({ range: nextRange });
    if (nextModel) params.set("model", nextModel);
    const response = await fetch(`/api/usage?${params.toString()}`, { cache: "no-store" });
    if (response.ok) setData((await response.json()) as UsagePayload);
  }, []);

  useEffect(() => {
    void load(range, model);
  }, [range, model, load]);

  const { totals, series, byModel } = data;
  const buckets = series.map((entry) => ({ ...entry, total: entry.input + entry.output + entry.cacheRead }));
  const max = Math.max(1, ...buckets.map((entry) => entry.total));
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const models = byModel.slice(0, 3);

  return (
    <section className="card">
      <header className="card-header flex-wrap">
        <h2 className="card-title">
          <Icon name="sparkles" className="h-4 w-4 text-muted" />
          LLM token usage
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              className="px-2.5 py-1 text-[11px] font-medium"
              style={
                view === "totals"
                  ? { background: "var(--hover)", color: "var(--ink)" }
                  : { color: "var(--muted)" }
              }
              onClick={() => setView("totals")}
            >
              Totals
            </button>
            <button
              type="button"
              className="border-l border-border px-2.5 py-1 text-[11px] font-medium"
              style={
                view === "models"
                  ? { background: "var(--hover)", color: "var(--ink)" }
                  : { color: "var(--muted)" }
              }
              onClick={() => setView("models")}
            >
              By model
            </button>
          </div>
          <span className="text-[11px] text-faint">
            {totals.runs} runs · {data.model ? "filtered" : "all models"}
          </span>
        </div>
      </header>

      <div className="card-body space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] text-muted">Total (input + output + cache read)</div>
            <div className="mt-1 text-3xl font-semibold leading-none tracking-tight text-ink">
              {compact(totals.total)}
            </div>
            <div className="mt-1 text-[11px] text-faint">{totals.tasks} tasks</div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: COLORS.input }} /> Input
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: COLORS.output }} /> Output
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: COLORS.cacheRead }} /> Cache read
              </span>
            </div>
            <div className="inline-flex overflow-hidden rounded-lg border border-border">
              {RANGES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="border-l border-border px-2.5 py-1 text-[11px] first:border-l-0"
                  style={
                    range === entry.id
                      ? { background: "var(--hover)", color: "var(--ink)", fontWeight: 600 }
                      : { color: "var(--muted)" }
                  }
                  onClick={() => setRange(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {models.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="badge"
              style={
                model === null
                  ? { background: "var(--accent)", color: "var(--accent-fg)" }
                  : { background: "var(--hover)", color: "var(--muted)" }
              }
              onClick={() => setModel(null)}
            >
              All
            </button>
            {models.map((entry, index) => (
              <button
                key={`${entry.provider}-${entry.model}`}
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[11px]"
                style={
                  model === entry.model
                    ? { background: "var(--hover)", color: "var(--ink)", fontWeight: 600 }
                    : { color: "var(--muted)" }
                }
                onClick={() => setModel(entry.model)}
              >
                {entry.model}
                {index === 0 && (
                  <span className="rounded bg-hover px-1 text-[10px] text-muted">
                    {entry.live ? "live" : "sim"}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          {view === "totals" ? (
            <div className="space-y-3">
              <Metric label="Input (cache miss)" value={totals.input} tone={COLORS.input} total={max} />
              <Metric label="Cache hit" value={totals.cacheRead} tone={COLORS.cacheRead} total={max} />
              <Metric label="Output" value={totals.output} tone={COLORS.output} total={max} />
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="text-[11px] text-muted">Cache hit rate</span>
                <span className="text-[12px] font-semibold text-ink">{totals.cacheHitRate}%</span>
              </div>
            </div>
          ) : (
            <ul className="space-y-2">
              {byModel.length === 0 && <li className="text-[11px] text-faint">No runs recorded yet.</li>}
              {byModel.map((entry) => (
                <li key={`${entry.provider}-${entry.model}`} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="mono text-ink">{entry.model}</span>
                    <span className="text-muted">{compact(entry.total)}</span>
                  </div>
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-subtle">
                    <span style={{ width: `${(entry.input / Math.max(1, entry.total)) * 100}%`, background: COLORS.input }} />
                    <span style={{ width: `${(entry.output / Math.max(1, entry.total)) * 100}%`, background: COLORS.output }} />
                    <span style={{ width: `${(entry.cacheRead / Math.max(1, entry.total)) * 100}%`, background: COLORS.cacheRead }} />
                  </div>
                  <div className="text-[10px] text-faint">
                    {entry.runs} runs · {entry.provider}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="relative h-56">
            {ticks.map((tick) => (
              <div
                key={tick}
                className="absolute inset-x-0 flex items-center gap-2"
                style={{ bottom: `${tick * 82}%` }}
              >
                <span className="w-12 shrink-0 text-right text-[10px] text-faint">
                  {tick === 0 ? "0" : compact(max * tick)}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ))}
            <div className="absolute bottom-0 left-14 right-0 top-2 flex items-end gap-3">
              {buckets.length === 0 && (
                <div className="pb-6 text-[11px] text-faint">No usage in this range yet.</div>
              )}
              {buckets.map((entry) => (
                <div key={entry.bucket} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                  <div className="flex flex-col justify-end" style={{ height: `${(entry.total / max) * 82}%` }}>
                    <span style={{ height: `${(entry.cacheRead / Math.max(1, entry.total)) * 100}%`, background: COLORS.cacheRead }} />
                    <span style={{ height: `${(entry.output / Math.max(1, entry.total)) * 100}%`, background: COLORS.output }} />
                    <span style={{ height: `${(entry.input / Math.max(1, entry.total)) * 100}%`, background: COLORS.input }} />
                  </div>
                  <div className="mt-1 truncate text-center text-[10px] text-faint">
                    {bucketLabel(entry.bucket, data.range)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, tone, total }: { label: string; value: number; tone: string; total: number }) {
  const pct = total > 0 ? Math.max(1, Math.round((value / total) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted">{label}</span>
        <span className="font-medium text-ink">{compact(value)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-subtle">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
      </div>
    </div>
  );
}
