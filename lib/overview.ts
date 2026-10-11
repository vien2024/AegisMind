import * as repo from "./repo";
import { runningTaskIds } from "./engine";
import type { ActivityRecord, Finding, Task } from "./types";

export interface OverviewPayload {
  tasks: {
    total: number;
    running: number;
    paused: number;
    completed: number;
    pending: number;
    failed: number;
    stopped: number;
    activeIds: number[];
  };
  assets: { total: number; byKind: Record<string, number> };
  findings: {
    total: number;
    confirmed: number;
    pending: number;
    bySeverity: Record<string, number>;
    recent: Array<Finding & { task_name: string | null }>;
  };
  traffic: { total: number };
  usage: {
    total: number;
    input: number;
    output: number;
    cacheRead: number;
    runs: number;
    tasks: number;
    cacheHitRate: number;
    live: boolean;
  };
  activity: Array<ActivityRecord & { task_name: string | null }>;
  generatedAt: string;
}

export function buildOverview(): OverviewPayload {
  const tasks: Task[] = repo.listTasks();
  const allFindings = repo.listFindings();
  const assets = repo.listAssets();
  const usage = repo.usageTotals();

  const counts = (status: string) => tasks.filter((task) => task.status === status).length;
  const bySeverity = allFindings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
    return acc;
  }, {});
  const byKind = assets.reduce<Record<string, number>>((acc, asset) => {
    acc[asset.kind] = (acc[asset.kind] ?? 0) + 1;
    return acc;
  }, {});

  const taskName = (id: number | null) => tasks.find((task) => task.id === id)?.name ?? null;

  const activity = tasks
    .flatMap((task) => repo.listActivity(task.id, 40))
    .sort((a, b) => b.id - a.id)
    .slice(0, 30)
    .map((entry) => ({ ...entry, task_name: taskName(entry.task_id) }));

  const recent = allFindings.slice(0, 8).map((finding) => ({ ...finding, task_name: taskName(finding.task_id) }));

  return {
    tasks: {
      total: tasks.length,
      running: counts("running"),
      paused: counts("paused"),
      completed: counts("completed"),
      pending: counts("pending"),
      failed: counts("failed"),
      stopped: counts("stopped"),
      activeIds: runningTaskIds(),
    },
    assets: { total: assets.length, byKind },
    findings: {
      total: allFindings.length,
      confirmed: allFindings.filter((finding) => finding.status === "confirmed").length,
      pending: allFindings.filter((finding) => finding.status === "pending").length,
      bySeverity,
      recent,
    },
    traffic: { total: repo.listTraffic(undefined, 5000).length },
    usage: {
      ...usage,
      cacheHitRate: usage.total > 0 ? Math.round((usage.cacheRead / usage.total) * 100) : 0,
      live: repo.listUsage(1).some((row) => row.live === 1),
    },
    activity,
    generatedAt: new Date().toISOString(),
  };
}
