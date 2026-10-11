"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatPanel } from "@/components/chat-panel";
import { Icon } from "@/components/shell/icons";
import { Badge, Card, Empty, SeverityBadge, StatusBadge } from "@/components/ui";
import type {
  ActivityRecord,
  Approval,
  Asset,
  ExplorationEdge,
  ExplorationNode,
  Finding,
  Task,
  TodoItem,
} from "@/lib/types";

interface GraphResponse {
  task: Task;
  counts: Record<string, number>;
  nodes: ExplorationNode[];
  edges: ExplorationEdge[];
  anchors: { node_id: number; asset_ids: number[] }[];
  assets: { id: number; kind: string; value: string }[];
  coverage: (Asset & { tested: boolean })[];
}

type Tab = "overview" | "graph" | "activity" | "findings" | "approvals" | "chat";

const TABS: { id: Tab; label: string; icon: React.ComponentProps<typeof Icon>["name"] }[] = [
  { id: "overview", label: "Overview", icon: "dashboard" },
  { id: "graph", label: "Exploration graph", icon: "gitBranch" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "findings", label: "Findings", icon: "bug" },
  { id: "approvals", label: "Interception approval", icon: "shield" },
  { id: "chat", label: "Main agent", icon: "chat" },
];

function ago(iso: string): string {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function TaskDetail({ initial }: { initial: GraphResponse }) {
  const router = useRouter();
  const [graph, setGraph] = useState<GraphResponse>(initial);
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const taskId = initial.task.id;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const [graphRes, activityRes, findingsRes, approvalsRes] = await Promise.all([
      fetch(`/api/tasks/${taskId}/graph`, { cache: "no-store" }),
      fetch(`/api/tasks/${taskId}/activity?limit=400`, { cache: "no-store" }),
      fetch(`/api/findings?taskId=${taskId}`, { cache: "no-store" }),
      fetch(`/api/approvals?taskId=${taskId}`, { cache: "no-store" }),
    ]);
    if (graphRes.ok) setGraph((await graphRes.json()) as GraphResponse);
    if (activityRes.ok) setActivity(((await activityRes.json()) as { activity: ActivityRecord[] }).activity);
    if (findingsRes.ok) setFindings(((await findingsRes.json()) as { findings: Finding[] }).findings);
    if (approvalsRes.ok) setApprovals(((await approvalsRes.json()) as { approvals: Approval[] }).approvals);
  }, [taskId]);

  useEffect(() => {
    void refresh();
    const source = new EventSource(`/api/tasks/${taskId}/stream`);
    source.onmessage = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void refresh(), 250);
    };
    source.onerror = () => source.close();
    return () => {
      source.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh, taskId]);

  useEffect(() => {
    if (graph.task.status !== "running") return;
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
  }, [graph.task.status, refresh]);

  async function control(action: string) {
    setBusy(true);
    await fetch(`/api/tasks/${taskId}/control`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(false);
    await refresh();
    router.refresh();
  }

  async function decide(id: number, decision: "approved" | "denied") {
    await fetch("/api/approvals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, decision }),
    });
    await refresh();
  }

  const assetsById = useMemo(() => new Map(graph.assets.map((a) => [a.id, a])), [graph.assets]);
  const anchorsByNode = useMemo(() => new Map(graph.anchors.map((a) => [a.node_id, a.asset_ids])), [graph.anchors]);
  const testedCount = graph.coverage.filter((c) => c.tested).length;
  const goal = graph.nodes.find((n) => n.kind === "goal");

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link href="/tasks" className="text-[11px] text-muted hover:text-ink">
              Tasks
            </Link>
            <Icon name="chevronRight" className="h-3 w-3 text-faint" />
            <h1 className="truncate text-[20px] font-semibold tracking-tight text-ink">{graph.task.name}</h1>
            <StatusBadge status={graph.task.status} />
          </div>
          <p className="mono mt-1 text-[11px] text-muted">
            target: {graph.task.target} · concurrency: {graph.task.concurrency} · language: {graph.task.language}
          </p>
          {graph.task.error && <p className="mt-1 text-[11px] text-red-600">{graph.task.error}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {graph.task.status === "running" ? (
            <>
              <button className="btn" disabled={busy} onClick={() => control("pause")}>
                <Icon name="pause" className="h-3.5 w-3.5" /> Pause
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => control("stop")}>
                <Icon name="stop" className="h-3.5 w-3.5" /> Stop
              </button>
            </>
          ) : graph.task.status === "paused" ? (
            <button className="btn btn-primary" disabled={busy} onClick={() => control("resume")}>
              <Icon name="play" className="h-3.5 w-3.5" /> Resume
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={() => control("start")}>
              <Icon name="play" className="h-3.5 w-3.5" />
              {graph.task.status === "pending" ? "Start" : "Run again"}
            </button>
          )}
          <button className="btn" disabled={busy} onClick={() => control("reset")}>
            <Icon name="reset" className="h-3.5 w-3.5" /> Reset
          </button>
          <a className="btn" href={`/api/tasks/${taskId}/report?format=md`}>
            <Icon name="download" className="h-3.5 w-3.5" /> Report
          </a>
          <a className="btn" href={`/api/tasks/${taskId}/report?format=csv`}>
            <Icon name="download" className="h-3.5 w-3.5" /> CSV
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="chip"
            data-active={tab === entry.id ? "true" : "false"}
            onClick={() => setTab(entry.id)}
          >
            <Icon name={entry.icon} className="h-3.5 w-3.5" />
            {entry.label}
            {entry.id === "findings" && findings.length > 0 && <span className="text-[10px]">{findings.length}</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Intents" value={graph.counts.intent ?? 0} hint="worker claims" />
            <Metric label="Facts" value={graph.counts.fact ?? 0} hint="verified observations" />
            <Metric label="Findings" value={graph.counts.finding ?? 0} hint={`${findings.length} recorded`} />
            <Metric label="Coverage" value={`${testedCount}/${graph.coverage.length}`} hint="in-scope assets tested" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Goal" icon="target">
              {goal ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={goal.status} />
                    <span className="text-[13px] text-ink">{goal.title}</span>
                  </div>
                  {goal.content && <p className="text-[11px] text-muted">{goal.content}</p>}
                </div>
              ) : (
                <Empty>No goal node.</Empty>
              )}
            </Card>

            <Card title="Interception gate" icon="shield" subtitle="Asset-touching tool calls">
              {approvals.length === 0 ? (
                <Empty icon="shield">No tool executions recorded yet.</Empty>
              ) : (
                <ul className="space-y-1.5 text-[11px]">
                  {approvals.slice(0, 5).map((approval) => (
                    <li key={approval.id} className="flex items-center justify-between gap-2">
                      <span className="mono text-muted">{approval.tool}</span>
                      <Badge tone={approval.status === "denied" ? "failed" : approval.status === "pending" ? "awaiting_approval" : "completed"}>
                        {approval.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Planner todolist" icon="layers" subtitle="Shared across wakes to keep the attack chain stable">
            <Todolist items={graph.task.todolist ?? []} />
          </Card>

          <Card title="Asset coverage" icon="box" subtitle="In-scope assets and whether the exploration graph has tested them">
            {graph.coverage.length === 0 ? (
              <Empty>No in-scope assets.</Empty>
            ) : (
              <ul className="space-y-1">
                {graph.coverage.map((asset) => (
                  <li key={asset.id} className="flex items-center justify-between border-b border-border py-1 last:border-0">
                    <span className="mono text-[11px] text-muted">
                      <span className="text-faint">{asset.kind}</span> {asset.value}
                    </span>
                    <Badge tone={asset.tested ? "completed" : "pending"}>{asset.tested ? "tested" : "untested"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "graph" && (
        <Card title="Exploration graph" icon="gitBranch" subtitle="goal → intent → fact → finding lineage, anchored to assets">
          {graph.nodes.length === 0 ? (
            <Empty>The graph is empty. Start the task to let the planner send intents.</Empty>
          ) : (
            <ul className="space-y-4">
              {graph.nodes
                .filter((node) => node.kind === "goal")
                .map((goalNode) => {
                  const intentIds = graph.edges
                    .filter((edge) => edge.from_id === goalNode.id && edge.relation === "spawns")
                    .map((edge) => edge.to_id);
                  const intents = graph.nodes.filter((node) => intentIds.includes(node.id));
                  return (
                    <li key={goalNode.id} className="space-y-2">
                      <NodeRow node={goalNode} assetsById={assetsById} anchorsByNode={anchorsByNode} />
                      <ul className="ml-5 space-y-2 border-l border-border pl-4">
                        {intents.map((intent) => {
                          const childIds = graph.edges
                            .filter((edge) => edge.from_id === intent.id && ["yields", "proves"].includes(edge.relation))
                            .map((edge) => edge.to_id);
                          const children = graph.nodes.filter((node) => childIds.includes(node.id));
                          return (
                            <li key={intent.id} className="space-y-1">
                              <NodeRow node={intent} assetsById={assetsById} anchorsByNode={anchorsByNode} />
                              <ul className="ml-5 space-y-1 border-l border-border pl-4">
                                {children.map((child) => (
                                  <li key={child.id}>
                                    <NodeRow node={child} assetsById={assetsById} anchorsByNode={anchorsByNode} />
                                  </li>
                                ))}
                              </ul>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>
      )}

      {tab === "activity" && (
        <Card title="Activity" icon="activity" subtitle="Planner wakes, worker steps and graph writes" padded={false}>
          {activity.length === 0 ? (
            <div className="card-body">
              <Empty>No activity yet.</Empty>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {activity.map((entry) => (
                <li key={entry.id} className="px-4 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono text-[11px] text-link">
                      {entry.role} · {entry.type}
                    </span>
                    <span className="text-[10px] text-faint">{ago(entry.created_at)}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink">{entry.title}</div>
                  {entry.content && (
                    <pre className="mono scroll mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[10.5px] text-faint">
                      {entry.content}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "findings" && (
        <Card title="Findings" icon="bug" subtitle="Recorded vulnerabilities and their disposition" padded={false}>
          {findings.length === 0 ? (
            <div className="card-body">
              <Empty>No findings recorded.</Empty>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Finding</th>
                    <th>Asset</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((finding) => (
                    <tr key={finding.id}>
                      <td>
                        <SeverityBadge severity={finding.severity} className="capitalize" />
                      </td>
                      <td className="max-w-[460px]">
                        <div className="text-[12.5px] font-medium text-ink">{finding.title}</div>
                        {finding.description && <div className="text-[11px] text-muted">{finding.description}</div>}
                      </td>
                      <td className="mono text-[11px] text-muted">
                        {finding.asset_id ? assetsById.get(finding.asset_id)?.value ?? `#${finding.asset_id}` : "—"}
                      </td>
                      <td>
                        <StatusBadge status={finding.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "approvals" && (
        <Card title="Interception approval" icon="shield" subtitle="Every asset-touching tool call is gated">
          {approvals.length === 0 ? (
            <Empty icon="shield">No approval records yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {approvals.map((approval) => (
                <li key={approval.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <div className="min-w-0">
                    <div className="mono text-[12px] text-ink">{approval.tool}</div>
                    <div className="mono mt-0.5 break-all text-[10.5px] text-faint">{approval.args}</div>
                    {approval.reason && <div className="mt-1 text-[11px] text-muted">{approval.reason}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={approval.status === "denied" ? "failed" : approval.status === "pending" ? "awaiting_approval" : "completed"}>
                      {approval.status}
                    </Badge>
                    {approval.status === "pending" && (
                      <>
                        <button className="btn px-2.5! py-1! text-[11px]!" onClick={() => decide(approval.id, "approved")}>
                          Approve
                        </button>
                        <button className="btn btn-danger px-2.5! py-1! text-[11px]!" onClick={() => decide(approval.id, "denied")}>
                          Deny
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "chat" && (
        <Card title="Main agent" icon="chat" subtitle="Human-in-the-loop chat over the Vercel AI SDK">
          <ChatPanel taskId={taskId} />
        </Card>
      )}
    </>
  );
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold leading-none tracking-tight text-ink">{value}</div>
      <div className="mt-1.5 text-[11px] text-faint">{hint}</div>
    </div>
  );
}

function Todolist({ items }: { items: TodoItem[] }) {
  if (!items.length) return <Empty>Planner has not recorded a todolist for this task yet.</Empty>;
  return (
    <ol className="space-y-1">
      {items.map((item, index) => (
        <li key={item.id} className="flex items-center gap-2 border-b border-border py-1 last:border-0">
          <span className="w-4 text-[11px] text-faint">{index + 1}.</span>
          <span className="flex-1 text-[12px] text-ink">{item.text}</span>
          {item.depends_on?.length ? <span className="text-[10px] text-faint">needs {item.depends_on.join(", ")}</span> : null}
          <Badge tone={item.status === "done" ? "completed" : item.status === "in_progress" ? "running" : item.status === "blocked" ? "blocked" : "pending"}>
            {item.status.replace(/_/g, " ")}
          </Badge>
        </li>
      ))}
    </ol>
  );
}

function NodeRow({
  node,
  assetsById,
  anchorsByNode,
}: {
  node: ExplorationNode;
  assetsById: Map<number, { id: number; kind: string; value: string }>;
  anchorsByNode: Map<number, number[]>;
}) {
  const anchors = anchorsByNode.get(node.id) ?? [];
  const tone =
    node.kind === "finding"
      ? "high"
      : node.kind === "fact"
        ? "completed"
        : node.kind === "goal"
          ? "running"
          : node.kind === "hint"
            ? "violet"
            : "low";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={tone}>{node.kind}</Badge>
      <span className="text-[12px] text-ink">{node.title}</span>
      <Badge tone={node.status === "done" ? "completed" : node.status === "running" ? "running" : node.status === "awaiting_approval" ? "awaiting_approval" : node.status === "blocked" ? "failed" : "pending"}>
        {node.status.replace(/_/g, " ")}
      </Badge>
      {anchors.length > 0 && (
        <span className="mono text-[10px] text-faint">
          ⚓ {anchors.map((id) => assetsById.get(id)?.value ?? `#${id}`).slice(0, 3).join(", ")}
        </span>
      )}
    </div>
  );
}
