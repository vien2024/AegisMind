import { runPlannerTurn, runWorkerTurn } from "./agents";
import { emitEvent } from "./events";
import * as repo from "./repo";
import type { TaskStatus } from "./types";

interface RunState {
  paused: boolean;
  stopped: boolean;
  running: boolean;
}

const globalForEngine = globalThis as unknown as { __aegismind_runs?: Map<number, RunState> };

function runs(): Map<number, RunState> {
  if (!globalForEngine.__aegismind_runs) globalForEngine.__aegismind_runs = new Map();
  return globalForEngine.__aegismind_runs;
}

export function isTaskRunning(taskId: number): boolean {
  return runs().get(taskId)?.running ?? false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pendingIntents(taskId: number) {
  return repo
    .listNodes(taskId, "intent", 500)
    .filter((node) => node.status === "pending")
    .sort((a, b) => a.id - b.id)
    .reverse();
}

/**
 * Reconciliation for the interception gate: approvals decided in the UI are
 * applied back onto the intents they block before the next planner wake.
 */
function reconcileApprovals(taskId: number): void {
  for (const approval of repo.listApprovals(taskId)) {
    if (approval.status === "pending") continue;
    if (!approval.intent_id) continue;
    const node = repo.getNode(approval.intent_id);
    if (!node) continue;
    if (approval.status === "approved" && node.status === "awaiting_approval") {
      repo.updateNodeStatus(node.id, "pending");
    }
    if (approval.status === "denied" && node.status === "awaiting_approval") {
      repo.updateNodeStatus(node.id, "blocked");
    }
  }
}

async function loop(taskId: number): Promise<void> {
  const state = runs().get(taskId);
  if (!state) return;
  let idlePlannerTurns = 0;

  try {
    while (true) {
      const task = repo.getTask(taskId);
      if (!task || state.stopped) break;
      if (task.status !== "running") break;

      reconcileApprovals(taskId);

      const plan = await runPlannerTurn(taskId);
      if (plan.proved) {
        repo.setTaskStatus(taskId, "completed");
        emitEvent({ type: "task", taskId, payload: { status: "completed" } });
        break;
      }

      const intents = pendingIntents(taskId);
      if (intents.length === 0) {
        const waitingOnApproval = repo
          .listApprovals(taskId)
          .some((approval) => approval.status === "pending");
        if (waitingOnApproval) {
          repo.addActivity({
            taskId,
            role: "engine",
            type: "event",
            title: "engine paused: waiting for interception approval",
          });
          emitEvent({ type: "task", taskId, payload: { status: "paused", reason: "approval" } });
          repo.setTaskStatus(taskId, "paused");
          break;
        }
        idlePlannerTurns += 1;
        if (idlePlannerTurns >= 2) {
          repo.setTaskStatus(taskId, "completed");
          repo.addActivity({
            taskId,
            role: "engine",
            type: "event",
            title: "engine stopped: planner produced no new direction",
          });
          emitEvent({ type: "task", taskId, payload: { status: "completed" } });
          break;
        }
        await sleep(300);
        continue;
      }

      idlePlannerTurns = 0;
      const fresh = repo.getTask(taskId);
      const concurrency = Math.max(1, fresh?.concurrency ?? 1);
      const batch = intents.slice(0, concurrency);

      emitEvent({ type: "workers", taskId, payload: { count: batch.length } });
      await Promise.all(batch.map((intent, index) => runWorkerTurn(taskId, intent.id, index + 1)));

      if (state.paused) {
        repo.setTaskStatus(taskId, "paused");
        break;
      }
      await sleep(120);
    }
  } catch (error) {
    repo.setTaskStatus(taskId, "failed", error instanceof Error ? error.message : String(error));
    repo.addActivity({
      taskId,
      role: "engine",
      type: "error",
      title: "engine failed",
      content: error instanceof Error ? error.stack ?? error.message : String(error),
    });
    emitEvent({ type: "task", taskId, payload: { status: "failed" } });
  } finally {
    state.running = false;
    runs().delete(taskId);
  }
}

export function startTask(taskId: number): { started: boolean; reason?: string } {
  const task = repo.getTask(taskId);
  if (!task) return { started: false, reason: "task not found" };
  if (isTaskRunning(taskId)) return { started: false, reason: "already running" };

  runs().set(taskId, { paused: false, stopped: false, running: true });
  repo.setTaskStatus(taskId, "running");
  emitEvent({ type: "task", taskId, payload: { status: "running" } });
  void loop(taskId);
  return { started: true };
}

export function pauseTask(taskId: number): void {
  const state = runs().get(taskId);
  if (state) state.paused = true;
  repo.setTaskStatus(taskId, "paused");
  emitEvent({ type: "task", taskId, payload: { status: "paused" } });
}

export function resumeTask(taskId: number): { started: boolean; reason?: string } {
  const state = runs().get(taskId);
  if (state) {
    state.paused = false;
    state.stopped = false;
  }
  return startTask(taskId);
}

export function stopTask(taskId: number): void {
  const state = runs().get(taskId);
  if (state) {
    state.stopped = true;
    state.running = false;
  }
  runs().delete(taskId);
  repo.setTaskStatus(taskId, "stopped");
  emitEvent({ type: "task", taskId, payload: { status: "stopped" } });
}

export function resetTask(taskId: number): void {
  stopTask(taskId);
  repo.setTaskStatus(taskId, "pending");
  repo.updateTask(taskId, { finished_at: null, error: null });
  emitEvent({ type: "task", taskId, payload: { status: "pending" } });
}

export function runningTaskIds(): number[] {
  return [...runs().entries()].filter(([, s]) => s.running).map(([id]) => id);
}

export function taskStatus(taskId: number): TaskStatus | null {
  return repo.getTask(taskId)?.status ?? null;
}
