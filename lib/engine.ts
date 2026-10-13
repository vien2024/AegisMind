import { runDeadlineValidationTurn, runPlannerTurn, runWorkerTurn } from "./agents";
import { emitEvent } from "./events";
import { resolveModel } from "./llm";
import * as repo from "./repo";
import type { TaskStatus } from "./types";

type DeadlineFindingCandidate = {
  findingId: number;
  type: "reflected_xss" | "sql_error";
  parameter: string;
  assetId: number;
};

interface RunState {
  paused: boolean;
  stopped: boolean;
  running: boolean;
  timeLimitReached: boolean;
  abortController: AbortController | null;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
  finalizing: boolean;
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

function deadlineReached(task: Awaited<ReturnType<typeof repo.getTask>>, state: RunState): boolean {
  if (
    task?.time_limit_minutes &&
    task.started_at &&
    Date.now() >= new Date(task.started_at).getTime() + task.time_limit_minutes * 60_000
  ) {
    state.timeLimitReached = true;
    state.abortController?.abort();
  }
  return state.timeLimitReached;
}

function deadlineFindingCandidate(finding: Awaited<ReturnType<typeof repo.listFindings>>[number]): DeadlineFindingCandidate | null {
  if (finding.validator_status !== "unverified" || finding.asset_id === null) return null;
  const description = `${finding.title} ${finding.description ?? ""} ${finding.evidence ?? ""}`;
  const type = finding.validator_type ??
    (/\b(reflected\s+XSS|cross.site scripting)\b/i.test(description)
      ? "reflected_xss"
      : /\b(SQLi|SQL injection|SQL error injection)\b/i.test(description)
        ? "sql_error"
        : null);
  if (!type) return null;

  const location = finding.location ?? "";
  const parameter = finding.validator_parameter ??
    location.match(/\bparameter\s*(?::|=|\s)\s*["'`]?([A-Za-z_][A-Za-z0-9_.-]{0,63})/i)?.[1] ??
    location.match(/[?&]([A-Za-z_][A-Za-z0-9_.-]{0,63})(?:=|[&#]|$)/)?.[1];
  if (!parameter || !/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(parameter)) return null;
  return { findingId: finding.id, type, parameter, assetId: finding.asset_id };
}

async function finalizeTimeLimitedTask(taskId: number, state: RunState): Promise<void> {
  if (state.finalizing) return;
  state.finalizing = true;
  const task = await repo.getTask(taskId);
  const limit = task?.time_limit_minutes;
  await repo.addActivity({
    taskId,
    role: "engine",
    type: "event",
    title: "task time limit reached",
    content: `The ${limit}-minute wall-clock assessment window ended. Normal assessment has stopped; the engine is validating eligible findings and preparing the final report.`,
    data: { time_limit_minutes: limit, started_at: task?.started_at },
  });

  for (const intent of await repo.listNodes(taskId, "intent", 1000)) {
    if (intent.status === "pending") await repo.updateNodeStatus(intent.id, "blocked");
  }

  const scope = await repo.listScopeAssets(taskId);
  const scopeIds = new Set(scope.filter((asset) => asset.kind === "endpoint").map((asset) => asset.id));
  const candidates = (await repo.listFindings(taskId))
    .map(deadlineFindingCandidate)
    .filter((candidate): candidate is DeadlineFindingCandidate =>
      candidate !== null && scopeIds.has(candidate.assetId),
    );
  let validationError: string | null = null;
  let validationSummary: string;

  if (candidates.length && process.env.AEGISMIND_ENABLE_LIVE_VALIDATION === "true") {
    const intent = await repo.createNode({
      taskId,
      kind: "intent",
      title: "Deadline finalization: validate supported findings",
      content: "Validate only the supported, previously identified findings listed in the deadline-validation prompt. Do not perform new assessment work.",
      status: "running",
      data: { purpose: "deadline-validation", finding_ids: candidates.map((finding) => finding.findingId) },
    });
    await repo.addAnchor(intent.id, [...new Set(candidates.map((finding) => finding.assetId))]);
    const goal = (await repo.listNodes(taskId, "goal", 1))[0];
    if (goal) await repo.addEdge(taskId, goal.id, intent.id, "spawns");

    try {
      await runDeadlineValidationTurn(taskId, intent.id, candidates);
      validationSummary = `${candidates.length} eligible finding(s) were passed to approval-gated validation.`;
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error);
      validationSummary = `Deadline validation failed: ${validationError}`;
      await repo.updateNodeStatus(intent.id, "failed");
      await repo.addActivity({
        taskId,
        intentId: intent.id,
        role: "engine",
        type: "error",
        title: "deadline validation failed",
        content: validationError,
      });
    }
  } else {
    const reason = candidates.length
      ? "Live validation is disabled; no probes were sent."
      : "No in-scope finding had a supported XSS/SQL-injection classification and an exact parameter in its recorded location; no probe was sent.";
    validationSummary = reason;
    await repo.addActivity({
      taskId,
      role: "engine",
      type: "event",
      title: "deadline validation skipped",
      content: reason,
      data: { eligible_findings: candidates.length },
    });
  }

  const finalFindings = await repo.listFindings(taskId);
  const unresolved = finalFindings.filter(
    (finding) => finding.validator_status === "unverified" || finding.validator_status === "awaiting_approval",
  ).length;
  await repo.addActivity({
    taskId,
    role: "engine",
    type: "event",
    title: "deadline report ready",
    content: `${validationSummary} ${unresolved} finding(s) remain unverified or awaiting approval. Download the task report for findings, evidence, and validation outcomes.`,
    data: {
      eligible_findings: candidates.length,
      unresolved_findings: unresolved,
      report_url: `/api/tasks/${taskId}/report?format=md`,
    },
  });
  await repo.setTaskStatus(taskId, "stopped", validationError ?? undefined);
  emitEvent({ type: "task", taskId, payload: { status: "stopped", reason: "time_limit", reportReady: true } });
}

async function pendingIntents(taskId: number) {
  return (await repo.listNodes(taskId, "intent", 500))
    .filter((node) => node.status === "pending")
    .sort((a, b) => a.id - b.id)
    .reverse();
}

/** Reconciliation for the interception gate: approvals decided in the UI are
 *  applied back onto the intents they block before the next planner wake.
 */
async function reconcileApprovals(taskId: number): Promise<void> {
  for (const approval of await repo.listApprovals(taskId)) {
    if (approval.status === "pending") continue;
    if (!approval.intent_id) continue;
    const node = await repo.getNode(approval.intent_id);
    if (!node) continue;
    if (approval.status === "approved" && node.status === "awaiting_approval") {
      await repo.updateNodeStatus(node.id, "pending");
    }
    if (approval.status === "denied" && node.status === "awaiting_approval") {
      await repo.updateNodeStatus(node.id, "blocked");
    }
  }
}

async function loop(taskId: number): Promise<void> {
  const state = runs().get(taskId);
  if (!state) return;
  let idlePlannerTurns = 0;

  try {
    while (true) {
      const task = await repo.getTask(taskId);
      if (!task || state.stopped) break;
      if (task.status !== "running") break;
      if (deadlineReached(task, state)) {
        await finalizeTimeLimitedTask(taskId, state);
        break;
      }

      await reconcileApprovals(taskId);

      const plannerController = new AbortController();
      state.abortController = plannerController;
      let plan: Awaited<ReturnType<typeof runPlannerTurn>>;
      try {
        plan = await runPlannerTurn(taskId, {
          recoverFromIdle: idlePlannerTurns > 0,
          abortSignal: plannerController.signal,
        });
      } catch (error) {
        if (!state.timeLimitReached) throw error;
        await finalizeTimeLimitedTask(taskId, state);
        break;
      } finally {
        if (state.abortController === plannerController) state.abortController = null;
      }
      if (deadlineReached(await repo.getTask(taskId), state)) {
        await finalizeTimeLimitedTask(taskId, state);
        break;
      }
      const intents = await pendingIntents(taskId);
      if (plan.proved && intents.length === 0) {
        await repo.setTaskStatus(taskId, "completed");
        emitEvent({ type: "task", taskId, payload: { status: "completed" } });
        break;
      }

      if (intents.length === 0) {
        const waitingOnApproval = (await repo.listApprovals(taskId)).some(
          (approval) => approval.status === "pending",
        );
        if (waitingOnApproval) {
          await repo.addActivity({
            taskId,
            role: "engine",
            type: "event",
            title: "engine paused: waiting for interception approval",
          });
          emitEvent({ type: "task", taskId, payload: { status: "paused", reason: "approval" } });
          await repo.setTaskStatus(taskId, "paused");
          break;
        }
        idlePlannerTurns += 1;
        if (idlePlannerTurns >= 4) {
          await repo.addActivity({
            taskId,
            role: "engine",
            type: "event",
            title: "engine paused: planner could not produce an actionable intent",
            content:
              "The planner created no intent after four coordinator turns. The task is paused, not completed. Review the scoped assets, todolist, and planner activity; add direction or context if needed, then resume the task.",
          });
          await repo.setTaskStatus(taskId, "paused");
          emitEvent({ type: "task", taskId, payload: { status: "paused", reason: "planner_needs_direction" } });
          break;
        }
        await sleep(300);
        continue;
      }

      idlePlannerTurns = 0;
      const fresh = await repo.getTask(taskId);
      const concurrency = Math.max(1, fresh?.concurrency ?? 1);
      const batch = intents.slice(0, concurrency);

      emitEvent({ type: "workers", taskId, payload: { count: batch.length } });
      const workerController = new AbortController();
      state.abortController = workerController;
      const workerResults = await Promise.allSettled(batch.map((intent, index) =>
        runWorkerTurn(taskId, intent.id, index + 1, workerController.signal),
      ));
      if (state.abortController === workerController) state.abortController = null;
      const workerFailure = workerResults.find((result) => result.status === "rejected");
      if (workerFailure?.status === "rejected" && !state.timeLimitReached) {
        throw workerFailure.reason;
      }

      if (deadlineReached(await repo.getTask(taskId), state)) {
        await finalizeTimeLimitedTask(taskId, state);
        break;
      }

      if (state.paused) {
        await repo.setTaskStatus(taskId, "paused");
        break;
      }
      await sleep(120);
    }
  } catch (error) {
    if (state.timeLimitReached) {
      const message = error instanceof Error ? error.message : String(error);
      if (state.finalizing) {
        await repo.addActivity({
          taskId,
          role: "engine",
          type: "error",
          title: "deadline finalization failed",
          content: message,
        });
        await repo.setTaskStatus(taskId, "stopped", `Time limit reached; finalization failed: ${message}`);
        emitEvent({ type: "task", taskId, payload: { status: "stopped", reason: "time_limit", reportReady: true } });
      } else {
        await finalizeTimeLimitedTask(taskId, state);
      }
    } else {
      await repo.setTaskStatus(
        taskId,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
      await repo.addActivity({
        taskId,
        role: "engine",
        type: "error",
        title: "engine failed",
        content: error instanceof Error ? error.stack ?? error.message : String(error),
      });
      emitEvent({ type: "task", taskId, payload: { status: "failed" } });
    }
  } finally {
    if (state.deadlineTimer) clearTimeout(state.deadlineTimer);
    state.running = false;
    runs().delete(taskId);
  }
}

export async function startTask(taskId: number): Promise<{ started: boolean; reason?: string }> {
  const task = await repo.getTask(taskId);
  if (!task) return { started: false, reason: "task not found" };
  if (isTaskRunning(taskId)) return { started: false, reason: "already running" };
  try {
    await resolveModel();
  } catch (error) {
    return {
      started: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (["completed", "failed", "stopped"].includes(task.status)) {
    await repo.updateTask(taskId, { started_at: null, finished_at: null, error: null });
  }
  const state: RunState = {
    paused: false,
    stopped: false,
    running: true,
    timeLimitReached: false,
    abortController: null,
    deadlineTimer: null,
    finalizing: false,
  };
  runs().set(taskId, state);
  await repo.setTaskStatus(taskId, "running");
  const startedTask = await repo.getTask(taskId);
  if (startedTask?.time_limit_minutes && startedTask.started_at) {
    const deadline = new Date(startedTask.started_at).getTime() + startedTask.time_limit_minutes * 60_000;
    state.deadlineTimer = setTimeout(() => {
      state.timeLimitReached = true;
      state.abortController?.abort();
    }, Math.max(0, deadline - Date.now()));
  }
  emitEvent({ type: "task", taskId, payload: { status: "running" } });
  void loop(taskId);
  return { started: true };
}

export async function pauseTask(taskId: number): Promise<void> {
  const state = runs().get(taskId);
  if (state) state.paused = true;
  await repo.setTaskStatus(taskId, "paused");
  emitEvent({ type: "task", taskId, payload: { status: "paused" } });
}

export async function resumeTask(
  taskId: number,
): Promise<{ started: boolean; reason?: string }> {
  const state = runs().get(taskId);
  if (state) {
    state.paused = false;
    state.stopped = false;
  }
  return startTask(taskId);
}

export async function stopTask(taskId: number): Promise<void> {
  const state = runs().get(taskId);
  if (state) {
    state.stopped = true;
    state.running = false;
    state.abortController?.abort();
    if (state.deadlineTimer) clearTimeout(state.deadlineTimer);
  }
  runs().delete(taskId);
  await repo.setTaskStatus(taskId, "stopped");
  emitEvent({ type: "task", taskId, payload: { status: "stopped" } });
}

export async function resetTask(taskId: number): Promise<void> {
  await stopTask(taskId);
  await repo.setTaskStatus(taskId, "pending");
  await repo.updateTask(taskId, { started_at: null, finished_at: null, error: null });
  emitEvent({ type: "task", taskId, payload: { status: "pending" } });
}

export function runningTaskIds(): number[] {
  return [...runs().entries()].filter(([, s]) => s.running).map(([id]) => id);
}

export async function taskStatus(taskId: number): Promise<TaskStatus | null> {
  return (await repo.getTask(taskId))?.status ?? null;
}
