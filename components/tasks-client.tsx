"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/shell/icons";
import { Card, Empty, SectionHeading, StatusBadge } from "@/components/ui";
import type { Company, Task } from "@/lib/types";

type TaskRow = Task & { counts: Record<string, number>; findings: number };

const TASK_TEMPLATES = [
  { id: "custom", label: "Custom task", name: "", goal: "" },
  {
    id: "full-pentest",
    label: "Full authorized assessment",
    name: "Full pentest",
    goal: [
      "Conduct a comprehensive security assessment of only the target and assets explicitly in this task's scope. Do not expand scope to third parties or newly discovered assets without explicit authorization.",
      "",
      "Maintain a phased checklist in the task todolist:",
      "1. Confirm scope, authorization assumptions, constraints, and unknowns.",
      "2. Recon explicitly authorized in-scope assets using the available shell and Python tools; choose appropriate non-destructive techniques and record concrete command output and observations.",
      "3. Assess common web/API risk areas: authentication and sessions, authorization and access control, input handling, injection and XSS, CSRF, SSRF, file uploads and path handling, exposed secrets, and business logic.",
      "4. Validate candidate issues with the minimum harmless evidence needed. If concrete evidence does not directly prove an issue, record only a fact or hypothesis; do not submit a finding.",
      "5. Every finding must include: Description (nature of the vulnerability), Reproduction (safe steps to trigger it), Location (exact affected asset/URL/path/parameter/component), Impact (what an attacker achieves), and non-empty sanitized Evidence that directly proves it. Also include severity, confidence, and remediation. Summarize coverage, untested areas, and limitations.",
      "Coordinator workflow: devise the plan first, dispatch independent Discovery, Authentication/Authorization, and Input/SSRF or Business Logic workers together when relevant, wait for the batch, review worker evidence and validator results, update the todolist/findings graph, then dispatch the next ready batch. Continue this loop until actionable work is exhausted or explicitly blocked.",
      "",
      "Safety limits: no denial-of-service or load testing, destructive changes, persistence, credential attacks, social engineering, lateral movement, or sensitive-data exfiltration. Stop and request clarification if authorization or scope is ambiguous.",
      "",
      "Important: simulated reconnaissance is disabled. Use available shell and Python tools for reconnaissance only on explicitly authorized in-scope assets. These tools run without per-run approval, are unrestricted and not sandboxed. Vulnerability validator probes still require explicit approval. Never claim remote assets were inspected or vulnerabilities verified without actual evidence.",
    ].join("\n"),
  },
] as const;

function ago(iso: string): string {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function TasksClient({ initialTasks, companies }: { initialTasks: TaskRow[]; companies: Company[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskTemplate, setTaskTemplate] = useState("custom");
  const [form, setForm] = useState({
    name: "",
    target: "demo.example.com",
    goal: "",
    context: "",
    concurrency: 3,
    timeLimitMinutes: null as number | null,
    language: "en" as "en" | "ko",
    autoApprove: true,
  });

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.name || undefined,
        target: form.target,
        goal: form.goal || undefined,
        description: form.context || undefined,
        concurrency: form.concurrency,
        timeLimitMinutes: form.timeLimitMinutes,
        language: form.language,
        autoApprove: form.autoApprove,
      }),
    });
    setCreating(false);
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not create task");
      return;
    }
    const { task } = (await response.json()) as { task: Task };
    router.push(`/tasks/${task.id}`);
  }

  async function control(id: number, action: string) {
    setBusy(id);
    const response = await fetch(`/api/tasks/${id}/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { reason?: string; error?: string };
      setError(payload.reason ?? payload.error ?? "Could not control task");
    } else {
      setError(null);
    }
    setBusy(null);
    router.refresh();
  }

  async function remove(id: number) {
    setBusy(id);
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    setBusy(null);
    router.refresh();
  }

  return (
    <>
      <SectionHeading
        title="Tasks"
        subtitle="One planner loop and up to N worker agents per task"
        action={
          <Link className="btn btn-primary" href="/tasks#new">
            <Icon name="plus" className="h-3.5 w-3.5" />
            New task
          </Link>
        }
      />

      <Card title="Create a task" icon="target" subtitle={`New assets attach to ${companies[0]?.name ?? "the default company"}`}>
        <form onSubmit={createTask} className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 md:col-span-2">
            <span className="text-[11px] text-muted">Task template</span>
            <select
              value={taskTemplate}
              onChange={(event) => {
                const selected = TASK_TEMPLATES.find((template) => template.id === event.target.value) ?? TASK_TEMPLATES[0];
                setTaskTemplate(selected.id);
                setForm((current) => ({ ...current, name: selected.name, goal: selected.goal }));
              }}
            >
              {TASK_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>{template.label}</option>
              ))}
            </select>
            {taskTemplate === "full-pentest" && (
              <span className="block text-[11px] text-faint">
                Agent tasks require an active live model. Agents use shell/Python tools for reconnaissance; validator probes require explicit approval. Shell commands and Python scripts run without approval and are not sandboxed.
              </span>
            )}
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted">Task name (optional)</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="External surface review" />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted">Target</span>
            <input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="demo.example.com" required />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-[11px] text-muted">Goal (optional)</span>
            <textarea
              rows={2}
              value={form.goal}
              onChange={(e) => setForm({ ...form, goal: e.target.value })}
              placeholder="Map the attack surface and record any findings."
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-[11px] text-muted">Supporting assessment context (optional)</span>
            <textarea
              rows={3}
              value={form.context}
              onChange={(e) => setForm({ ...form, context: e.target.value })}
              placeholder="API routes, documentation, architecture notes, known authentication flows, or testing constraints. Do not include passwords, tokens, or other secrets."
            />
            <span className="block text-[11px] text-faint">
              Context is stored with the task. Avoid including secrets. Agents cannot perform general target reconnaissance in this build.
            </span>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted">Worker concurrency (1–10)</span>
            <input type="number" min={1} max={10} value={form.concurrency} onChange={(e) => setForm({ ...form, concurrency: Number(e.target.value) })} />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted">Time limit in minutes (optional)</span>
            <input
              type="number"
              min={1}
              max={1440}
              step={1}
              value={form.timeLimitMinutes ?? ""}
              placeholder="No limit"
              onChange={(e) => setForm({ ...form, timeLimitMinutes: e.target.value ? Number(e.target.value) : null })}
            />
            <span className="block text-[10px] text-faint">Wall-clock time from first start, including pauses. At expiry, assessment stops and supported findings enter approval-gated validation.</span>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted">Language</span>
            <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as "en" | "ko" })}>
              <option value="en">English</option>
              <option value="ko">한국어</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-muted md:col-span-2">
            <input
              type="checkbox"
              checked={form.autoApprove}
              onChange={(e) => setForm({ ...form, autoApprove: e.target.checked })}
            />
            Auto-approve asset-touching tools (otherwise each call waits on the interception gate)
          </label>
          <div className="flex items-center gap-3 md:col-span-2">
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? "Creating…" : "Create task"}
            </button>
            {error && <span className="text-[11px] text-red-600">{error}</span>}
          </div>
        </form>
      </Card>

      <Card title="All tasks" icon="layers" subtitle={`${initialTasks.length} total`} padded={false}>
        {initialTasks.length === 0 ? (
          <div className="card-body">
            <Empty>No tasks yet — create one above to start the planner.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Graph</th>
                  <th>Findings</th>
                  <th>Created</th>
                  <th>Controls</th>
                </tr>
              </thead>
              <tbody>
                {initialTasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <Link className="text-[12.5px] font-medium text-link hover:underline" href={`/tasks/${task.id}`}>
                        {task.name}
                      </Link>
                      <div className="mono text-[11px] text-faint">{task.target}</div>
                    </td>
                    <td>
                      <StatusBadge status={task.status} />
                    </td>
                    <td className="mono whitespace-nowrap text-[11px] text-muted">
                      g{task.counts.goal ?? 0} · i{task.counts.intent ?? 0} · f{task.counts.fact ?? 0} · v{task.counts.finding ?? 0}
                    </td>
                    <td className="text-[12px]">{task.findings}</td>
                    <td className="whitespace-nowrap text-[11px] text-faint">{ago(task.created_at)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {task.status === "running" ? (
                          <>
                            <button className="btn px-2! py-1! text-[11px]!" disabled={busy === task.id} onClick={() => control(task.id, "pause")}>
                              <Icon name="pause" className="h-3 w-3" /> Pause
                            </button>
                            <button className="btn btn-danger px-2! py-1! text-[11px]!" disabled={busy === task.id} onClick={() => control(task.id, "stop")}>
                              <Icon name="stop" className="h-3 w-3" /> Stop
                            </button>
                          </>
                        ) : task.status === "paused" ? (
                          <button className="btn btn-primary px-2! py-1! text-[11px]!" disabled={busy === task.id} onClick={() => control(task.id, "resume")}>
                            <Icon name="play" className="h-3 w-3" /> Resume
                          </button>
                        ) : (
                          <button className="btn btn-primary px-2! py-1! text-[11px]!" disabled={busy === task.id} onClick={() => control(task.id, "start")}>
                            <Icon name="play" className="h-3 w-3" /> {task.status === "pending" ? "Start" : "Run again"}
                          </button>
                        )}
                        <button className="btn px-2! py-1! text-[11px]!" disabled={busy === task.id} onClick={() => control(task.id, "reset")}>
                          <Icon name="reset" className="h-3 w-3" />
                        </button>
                        <button className="btn btn-danger px-2! py-1! text-[11px]!" disabled={busy === task.id} onClick={() => remove(task.id)}>
                          <Icon name="trash" className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
