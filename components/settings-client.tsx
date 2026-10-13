"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/shell/icons";
import { Badge, SectionHeading } from "@/components/ui";

interface SettingsPayload {
  settings: {
    language: string;
    autoApprove: boolean;
    concurrency: number;
    plannerMaxSteps: number;
    workerMaxSteps: number;
    traceSearchLimit: number;
  };
  env: { openai: boolean; anthropic: boolean; database: string };
  activeLlm: { id: number; name: string; provider: string; model: string } | null;
  stats: { tasks: number; assets: number; findings: number; traffic: number; activities: number; dbBytes: number };
  version: string;
  runtime: string;
}

function Kb(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border transition-colors disabled:opacity-50"
      style={{ background: checked ? "var(--accent)" : "var(--hover)" }}
    >
      <span
        className="absolute h-3.5 w-3.5 rounded-full bg-panel transition-[left] duration-150"
        style={{ left: checked ? 18 : 3, border: "1px solid var(--border-strong)" }}
      />
    </button>
  );
}

function SettingCard({
  icon,
  title,
  children,
  right,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-body space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="card-title">
            <Icon name={icon} className="h-4 w-4 text-muted" />
            {title}
          </h2>
          {right}
        </div>
        <div className="space-y-3 text-[12px] leading-relaxed text-muted">{children}</div>
      </div>
    </section>
  );
}

export function SettingsClient({ initial }: { initial: SettingsPayload }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (response.ok) {
      const payload = (await response.json()) as { settings: SettingsPayload["settings"] };
      setData((prev) => ({ ...prev, settings: payload.settings }));
      setMessage("Saved.");
      router.refresh();
    }
  }

  const { settings, env, stats } = data;

  return (
    <>
      <SectionHeading title="System settings" subtitle="Global runtime switches" />

      {message && (
        <div className="rounded-lg border border-border bg-subtle px-3 py-2 text-[11px] text-muted">{message}</div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <SettingCard icon="download" title="Version and updates">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[12px] text-muted">Current version</span>
            <span className="mono rounded-md border border-border px-1.5 py-0.5 text-[11px] text-ink">{data.version}</span>
            <span className="text-muted">/</span>
            <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-ink">{data.runtime}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn" type="button" onClick={() => setMessage("This is a local build — there is no update channel.")}>
              <Icon name="refresh" className="h-3.5 w-3.5" />
              Check for updates
            </button>
            <button className="btn btn-primary" type="button" disabled onClick={() => undefined}>
              <Icon name="download" className="h-3.5 w-3.5" />
              Update now
            </button>
          </div>
          <p className="text-[11px] text-faint">
            The upstream edition downloads release binaries and swaps itself in place. This Next.js
            edition is built from source — pull the repository and rebuild instead. Updating
            interrupts running tasks.
          </p>
        </SettingCard>

        <SettingCard
          icon="shield"
          title="Interception gate"
          right={
            <Toggle
              checked={settings.autoApprove}
              disabled={busy}
              onChange={(value) => save({ autoApprove: value })}
            />
          }
        >
          <p>
            When enabled, ordinary gated calls may be approved automatically.{" "}
            <span className="mono">validate_finding</span> always requires fresh manual approval.
            Shell commands and Python scripts run without per-run approval, start in the workspace,
            and are not sandboxed.
          </p>
          <p>
            When disabled, every approval-gated call is held for manual approval, the intent moves to{" "}
            <span className="mono">awaiting_approval</span> and the task pauses until you decide. Decisions are
            recorded under{" "}
            <Link href="/approval-records" className="text-link hover:underline">
              Approval records
            </Link>
            .
          </p>
          <p className="text-[11px] text-faint">
            {settings.autoApprove
              ? "Enabled · live validator probes still wait for approval"
              : "Disabled · every gated call waits for approval"}
          </p>
        </SettingCard>

        <SettingCard icon="bot" title="Agent runtime">
          <p>Workers claimed per planner wake, and how many AI SDK steps each agent turn may take.</p>
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] text-faint">Workers per task</span>
              <input
                type="number"
                min={1}
                max={10}
                defaultValue={settings.concurrency}
                disabled={busy}
                onBlur={(event) => save({ concurrency: Number(event.target.value) })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-faint">Planner max steps</span>
              <input
                type="number"
                min={1}
                max={30}
                defaultValue={settings.plannerMaxSteps}
                disabled={busy}
                onBlur={(event) => save({ plannerMaxSteps: Number(event.target.value) })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-faint">Worker max steps</span>
              <input
                type="number"
                min={1}
                max={40}
                defaultValue={settings.workerMaxSteps}
                disabled={busy}
                onBlur={(event) => save({ workerMaxSteps: Number(event.target.value) })}
              />
            </label>
          </div>
          <p className="text-[11px] text-faint">
            These are the defaults for new tasks; each task also carries its own worker count.
          </p>
        </SettingCard>

        <SettingCard icon="layers" title="Worker trace search">
          <p>
            <span className="mono">search_all_worker_traces</span> lets a worker reuse the execution process of
            other workers in the same task. This caps how many hits it returns per query.
          </p>
          <div className="flex items-end gap-2">
            <label className="max-w-[160px] space-y-1">
              <span className="text-[11px] text-faint">Max hits per query</span>
              <input
                type="number"
                min={1}
                max={200}
                defaultValue={settings.traceSearchLimit}
                disabled={busy}
                onBlur={(event) => save({ traceSearchLimit: Number(event.target.value) })}
              />
            </label>
            <span className="pb-2 text-[11px] text-faint">1–200</span>
          </div>
        </SettingCard>

        <SettingCard icon="globe" title="Language">
          <p>
            Durable default language for tasks created over HTTP and for the interface preference. A task keeps
            the language it was created with.
          </p>
          <select
            value={settings.language}
            disabled={busy}
            onChange={(event) => save({ language: event.target.value })}
            className="max-w-[200px]"
          >
            <option value="en">English</option>
            <option value="ko">한국어</option>
          </select>
        </SettingCard>

        <SettingCard icon="database" title="Storage">
          <p>
            Single local SQLite database at <span className="mono text-ink">{env.database}</span> ({Kb(stats.dbBytes)}).
            Schema is created idempotently on every start — restart is migrate.
          </p>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            {[
              ["Tasks", stats.tasks],
              ["Asset nodes", stats.assets],
              ["Findings", stats.findings],
              ["Traffic", stats.traffic],
              ["Activity", stats.activities],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border border-border px-2 py-1.5">
                <div className="text-[10px] text-faint">{label}</div>
                <div className="text-[12px] font-medium text-ink">{value}</div>
              </div>
            ))}
          </div>
        </SettingCard>

        <SettingCard icon="key" title="Provider credentials">
          <p>
            Environment variables are used as a fallback when no model profile is active. Keys entered on the{" "}
            <Link href="/llm" className="text-link hover:underline">
              LLM
            </Link>{" "}
            page are stored in the local database and are never returned by the API.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-faint">Environment:</span>
            {env.openai ? (
              <Badge tone="completed">OPENAI_API_KEY</Badge>
            ) : (
              <Badge tone="neutral">no OPENAI_API_KEY</Badge>
            )}
            {env.anthropic ? (
              <Badge tone="completed">ANTHROPIC_API_KEY</Badge>
            ) : (
              <Badge tone="neutral">no ANTHROPIC_API_KEY</Badge>
            )}
          </div>
          <p className="text-[11px] text-faint">
            Active model profile:{" "}
            {data.activeLlm ? (
              data.activeLlm.provider === "mock" ? (
                <span className="text-red-600">
                  {data.activeLlm.name} is a legacy simulator profile and cannot run agents. Activate a live model.
                </span>
              ) : (
                <span className="mono text-ink">
                  {data.activeLlm.name} · {data.activeLlm.provider}/{data.activeLlm.model}
                </span>
              )
            ) : (
              "none — task agents are disabled until a live provider is configured"
            )}
          </p>
        </SettingCard>
      </div>
    </>
  );
}
