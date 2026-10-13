"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/shell/icons";
import { Card, SectionHeading } from "@/components/ui";

const GATED = [
  {
    tool: "validate_finding",
    description: "Sends one bounded live probe only after explicit approval; this remains gated when auto-approval is on.",
  },
];

const UNGATED = [
  { tool: "submit_asset", description: "Writes a raw observation into the global asset graph." },
  { tool: "submit_fact", description: "Writes a verified observation into the exploration graph." },
  { tool: "submit_finding", description: "Records a vulnerability as a finding." },
  { tool: "search_all_worker_traces", description: "Reads other workers' execution steps." },
];

const WORKSPACE_EXECUTION = [
  { tool: "execute_cmd", description: "Runs shell commands from the workspace without per-run approval." },
  { tool: "write_python_file", description: "Creates or replaces .py files in agent-python." },
  { tool: "run_python_file", description: "Runs Python files from agent-python without per-run approval." },
];

export function InterceptionClient({ autoApprove }: { autoApprove: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(autoApprove);
  const [busy, setBusy] = useState(false);

  async function toggle(value: boolean) {
    setBusy(true);
    setEnabled(value);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ autoApprove: value }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <>
      <SectionHeading title="Interception rules" subtitle="Default approval behavior for tools that touch assets" />

      <Card title="Policy" icon="shield" subtitle="Applies to tools that require an approval decision">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-xl text-[12px] leading-relaxed text-muted">
            <p>
              When auto-approval is <strong className="text-ink">on</strong>, ordinary gated calls are recorded
              and allowed immediately. When it is <strong className="text-ink">off</strong>, those calls wait for
            a decision. <span className="mono">validate_finding</span> always waits for a manual decision,
            regardless of this setting. Workspace shell and Python tools run without per-invocation
            approval and are not sandboxed.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={busy}
            onClick={() => toggle(!enabled)}
            className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border"
            style={{ background: enabled ? "var(--accent)" : "var(--hover)" }}
          >
            <span
              className="absolute h-3.5 w-3.5 rounded-full bg-panel"
              style={{ left: enabled ? 18 : 3, border: "1px solid var(--border-strong)" }}
            />
          </button>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-faint">
          <Icon name="shield" className="h-3.5 w-3.5" />
          {enabled ? "Auto-approval on · live validation remains approval-gated" : "Auto-approval off · gated calls wait for a decision"}
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Workspace execution" icon="wrench" subtitle="Unrestricted and not sandboxed">
          <ul className="space-y-2">
            {WORKSPACE_EXECUTION.map((entry) => (
              <li key={entry.tool} className="rounded-lg border border-border px-3 py-2">
                <div className="mono text-[11.5px] text-ink">{entry.tool}</div>
                <div className="text-[11px] text-muted">{entry.description}</div>
              </li>
            ))}
            <li className="text-[11px] text-faint">
              Each process has a 60-second timeout and capped returned output. Processes run with the
              application user's operating-system permissions.
            </li>
          </ul>
        </Card>
        <Card title="Gated tools" icon="lock" subtitle="Held or recorded before execution">
          <ul className="space-y-2">
            {GATED.map((entry) => (
              <li key={entry.tool} className="rounded-lg border border-border px-3 py-2">
                <div className="mono text-[11.5px] text-ink">{entry.tool}</div>
                <div className="text-[11px] text-muted">{entry.description}</div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Ungated tools" icon="layers" subtitle="Pure graph reads and writes">
          <ul className="space-y-2">
            {UNGATED.map((entry) => (
              <li key={entry.tool} className="rounded-lg border border-border px-3 py-2">
                <div className="mono text-[11.5px] text-ink">{entry.tool}</div>
                <div className="text-[11px] text-muted">{entry.description}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
