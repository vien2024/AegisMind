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
    cacheWrite: number;
    runs: number;
    tasks: number;
    cacheHitRate: number;
    live: boolean;
  };
  activity: Array<ActivityRecord & { task_name: string | null }>;
  generatedAt: string;
}

export async function buildOverview(): Promise<OverviewPayload> {
  const [taskGroups, findings, assets, usage, trafficTotal, activity, recentUsage] = await Promise.all([
    repo.listTaskSummaries(),
    repo.findingSummary(8),
    repo.assetKindCounts(),
    repo.usageTotals(),
    repo.countTraffic(),
    repo.listRecentActivity(30),
    repo.listUsage(1),
  ]);

  const counts = new Map(taskGroups.map((group) => [group.status, group.count]));
  const count = (status: string) => counts.get(status) ?? 0;

  return {
    tasks: {
      total: taskGroups.reduce((sum, group) => sum + group.count, 0),
      running: count("running"),
      paused: count("paused"),
      completed: count("completed"),
      pending: count("pending"),
      failed: count("failed"),
      stopped: count("stopped"),
      activeIds: runningTaskIds(),
    },
    assets,
    findings: {
      total: findings.total,
      confirmed: findings.confirmed,
      pending: findings.pending,
      bySeverity: findings.bySeverity,
      recent: findings.recent,
    },
    traffic: { total: trafficTotal },
    usage: {
      ...usage,
      cacheHitRate: usage.total > 0 ? Math.round((usage.cacheRead / usage.total) * 100) : 0,
      live: recentUsage.some((row) => row.live === 1),
    },
    activity,
    generatedAt: new Date().toISOString(),
  };
}
