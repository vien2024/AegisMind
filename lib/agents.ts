import { ToolLoopAgent, stepCountIs, type ToolSet } from "ai";
import { buildPlannerTools, buildWorkerTools, coverageSnapshot, graphOverview, type RunContext } from "./agent-tools";
import { resolveModel } from "./llm";
import type { MockStep } from "./mock-model";
import * as repo from "./repo";
import { simulateRecon, techniqueFor } from "./simulate";
import type { Task } from "./types";

function recordUsage(taskId: number, role: string, resolved: { provider: string; modelId: string; live: boolean }, usage: unknown) {
  const u = usage as
    | {
        inputTokens?: number;
        outputTokens?: number;
        inputTokenDetails?: { noCacheTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
        cachedInputTokens?: number;
      }
    | undefined;
  repo.recordUsage({
    taskId,
    role,
    provider: resolved.provider,
    model: resolved.modelId,
    live: resolved.live,
    inputTokens: u?.inputTokens ?? 0,
    outputTokens: u?.outputTokens ?? 0,
    cacheReadTokens: u?.inputTokenDetails?.cacheReadTokens ?? u?.cachedInputTokens ?? 0,
    cacheWriteTokens: u?.inputTokenDetails?.cacheWriteTokens ?? 0,
  });
}

/* ------------------------------------------------------------------ */
/* Instructions                                                        */
/* ------------------------------------------------------------------ */

const PLANNER_INSTRUCTIONS = `You are the PLANNER of AegisMind, an LLM multi-agent exploration system.

You are the only component allowed to generate intents. On every wake you:
1. Read the exploration graph (get_graph_overview) and the coverage of in-scope assets (get_coverage).
2. Maintain the shared planning todolist across wakes so a multi-step chain stays stable.
3. Send 0..N intents. Most wakes send ZERO. Only send an intent when there is an uncovered,
   specific direction that advances the goal. Never repeat an existing intent.
4. Call prove_goal only when no reachable direction remains.

Rules:
- One intent = one worker = one bounded piece of work. Keep titles short and imperative.
- Anchor each intent to the asset ids it probes.
- If a step of your todolist depends on a fact that does not exist yet, mark it "blocked" and wait
  for the next wake instead of sending it early.
- This edition explores a strictly local, offline simulation. Do not attempt to reach real systems.`;

const WORKER_INSTRUCTIONS = `You are a WORKER of AegisMind. You claim exactly ONE intent and you never expand it.

Workflow:
1. get_intent_context to load the intent and its anchored assets. list_scope for the task scope.
2. Before doing new work, search_all_worker_traces for keywords from your intent so you can reuse
   what other workers already observed (their in-process observations are valid evidence).
3. Run tools with run_recon / http_probe / dns_lookup. These are LOCAL SIMULATIONS in this edition.
4. Write back everything you learned:
   - submit_asset for every new asset you observed (parent_id when known).
   - submit_fact for verified observations, anchored to the assets they concern.
   - submit_finding when the observation proves a vulnerability, with severity and evidence.
5. finish_intent with a one-line summary.

Rules:
- Do only your one intent. Do not invent new directions; that is the planner's job.
- Prefer concrete evidence over speculation. If a tool is blocked pending approval, record what you
  could complete and finish the intent.`;

/* ------------------------------------------------------------------ */
/* Prompt builders                                                     */
/* ------------------------------------------------------------------ */

function scopeSummary(taskId: number): string {
  const scope = repo.listScopeAssets(taskId);
  if (!scope.length) return "(no in-scope assets yet)";
  return scope.map((a) => `- ${a.kind} ${a.value} (asset_id=${a.id})`).join("\n");
}

function plannerPrompt(task: Task): string {
  return [
    `Task: ${task.name}`,
    `Target: ${task.target}`,
    task.goal ? `Goal: ${task.goal}` : "Goal: determine the attack surface and record any findings.",
    "",
    "In-scope assets:",
    scopeSummary(task.id),
    "",
    "Decide the next move. Remember: most wakes should send zero intents.",
  ].join("\n");
}

function workerPrompt(task: Task, intentId: number): string {
  const intent = repo.getNode(intentId);
  return [
    `Task: ${task.name} (target ${task.target})`,
    `Your intent #${intentId}: ${intent?.title ?? "(unknown)"}`,
    intent?.content ? `Details: ${intent.content}` : "",
    "",
    "In-scope assets:",
    scopeSummary(task.id),
    "",
    "Execute this one intent, write your observations back to both graphs, then finish_intent.",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* Offline (mock) scripts                                              */
/* ------------------------------------------------------------------ */

export function plannerScript(taskId: number): MockStep[] {
  const overview = graphOverview(taskId);
  const coverage = coverageSnapshot(taskId);
  const steps: MockStep[] = [
    { type: "tool", toolName: "get_graph_overview", input: {} },
    { type: "tool", toolName: "get_coverage", input: {} },
  ];

  if (overview.goal?.status === "done") {
    steps.push({ type: "text", text: "Goal already proven." });
    return steps;
  }
  if (overview.openIntents.length > 0) {
    steps.push({ type: "text", text: `Waiting for workers on ${overview.openIntents.length} open intent(s).` });
    return steps;
  }

  const untested = coverage.filter((asset) => !asset.tested);
  if (untested.length === 0) {
    steps.push({
      type: "tool",
      toolName: "prove_goal",
      input: {
        conclusion:
          "All in-scope assets were exercised and the exploration frontier is empty; no further direction remains.",
      },
    });
    return steps;
  }

  const target = untested[0]!;
  const asset = repo.getAsset(target.id)!;
  const technique = techniqueFor(asset, taskId);
  steps.push({
    type: "tool",
    toolName: "send_intent",
    input: {
      title: `Assess ${target.value}`,
      description: `Exercise ${target.value} with ${technique} to map reachable surface and collect evidence.`,
      asset_ids: [target.id],
    },
  });
  return steps;
}

export function workerScript(taskId: number, intentId: number): MockStep[] {
  const anchored = repo.listAnchoredAssetIds(intentId);
  const assetId = anchored[0];
  const steps: MockStep[] = [{ type: "tool", toolName: "get_intent_context", input: {} }];
  if (assetId === undefined) {
    steps.push({ type: "tool", toolName: "finish_intent", input: { summary: "Intent had no anchored asset; nothing to do." } });
    return steps;
  }
  const asset = repo.getAsset(assetId);
  if (!asset) {
    steps.push({ type: "tool", toolName: "finish_intent", input: { summary: "Anchored asset no longer exists." } });
    return steps;
  }

  const technique = techniqueFor(asset, intentId);
  steps.push({ type: "tool", toolName: "list_scope", input: {} });
  steps.push({
    type: "tool",
    toolName: "search_all_worker_traces",
    input: { query: asset.value.split(".")[0] ?? asset.value },
  });
  steps.push({ type: "tool", toolName: "run_recon", input: { asset_id: assetId, technique } });

  // If the interception gate is on and no decision exists yet, the run_recon call above will be
  // held. Stop here so the intent stays "awaiting_approval" and the engine pauses instead of
  // finishing an intent that never actually ran.
  const task = repo.getTask(taskId);
  const requiresApproval = task ? task.auto_approve !== 1 : false;
  const decided = repo.findDecidedApproval(taskId, intentId, "run_recon");
  if (requiresApproval && !decided) {
    steps.push({ type: "text", text: "Reconnaissance is held by the interception gate." });
    return steps;
  }

  // simulateRecon is deterministic, so the script can predict what run_recon will return
  // and emit the matching write-back calls.
  const predicted = simulateRecon({ taskId, intentId, asset, technique });
  steps.push({
    type: "tool",
    toolName: "submit_fact",
    input: {
      title: `${technique} surface of ${asset.value}`,
      content: predicted.observations.join("\n"),
      anchor_asset_ids: [assetId],
    },
  });
  for (const discovered of predicted.assets) {
    steps.push({
      type: "tool",
      toolName: "submit_asset",
      input: {
        kind: discovered.kind,
        value: discovered.value,
        parent_id: assetId,
        attributes: discovered.attributes ?? {},
      },
    });
  }
  if (predicted.finding) {
    steps.push({
      type: "tool",
      toolName: "submit_finding",
      input: {
        title: predicted.finding.title,
        severity: predicted.finding.severity,
        description: predicted.finding.description,
        evidence: predicted.finding.evidence,
        asset_id: assetId,
      },
    });
  }
  steps.push({ type: "tool", toolName: "finish_intent", input: { summary: predicted.summary } });
  return steps;
}

/* ------------------------------------------------------------------ */
/* Turns                                                               */
/* ------------------------------------------------------------------ */

export async function runPlannerTurn(taskId: number): Promise<{ proved: boolean; live: boolean; provider: string }> {
  const task = repo.getTask(taskId);
  if (!task) return { proved: false, live: false, provider: "none" };

  const ctx: RunContext = { task, role: "planner" };
  const tools = buildPlannerTools(ctx) as unknown as ToolSet;
  const settings = repo.getSystemSettings();
  const resolved = resolveModel({
    script: plannerScript(taskId),
    modelId: "aegismind-planner-sim",
  });

  const agent = new ToolLoopAgent({
    id: "planner",
    model: resolved.model,
    instructions: PLANNER_INSTRUCTIONS,
    tools,
    stopWhen: stepCountIs(settings.plannerMaxSteps),
  });

  repo.addActivity({ taskId, role: "planner", type: "wake", title: "planner wake" });
  const goalBefore = repo.listNodes(taskId, "goal", 1)[0];
  const result = await agent.generate({ prompt: plannerPrompt(task) });
  recordUsage(taskId, "planner", resolved, result.usage);
  const goalAfter = repo.listNodes(taskId, "goal", 1)[0];

  repo.addActivity({
    taskId,
    role: "planner",
    type: "message",
    title: "planner finished",
    content: result.text?.slice(0, 4000) ?? "",
    data: { steps: result.steps.length, provider: resolved.provider, live: resolved.live },
  });

  return {
    proved: Boolean(goalAfter && goalAfter.status === "done") && goalBefore?.status !== "done",
    live: resolved.live,
    provider: resolved.provider,
  };
}

export async function runWorkerTurn(
  taskId: number,
  intentId: number,
  workerIndex: number,
): Promise<void> {
  const task = repo.getTask(taskId);
  if (!task) return;

  repo.updateNodeStatus(intentId, "running");
  const ctx: RunContext = { task, role: "worker", intentId, workerIndex };
  const tools = buildWorkerTools(ctx) as unknown as ToolSet;
  const settings = repo.getSystemSettings();
  const resolved = resolveModel({
    script: workerScript(taskId, intentId),
    modelId: `aegismind-worker-sim`,
  });

  const agent = new ToolLoopAgent({
    id: `worker-${workerIndex}`,
    model: resolved.model,
    instructions: WORKER_INSTRUCTIONS,
    tools,
    stopWhen: stepCountIs(settings.workerMaxSteps),
  });

  try {
    const result = await agent.generate({ prompt: workerPrompt(task, intentId) });
    recordUsage(taskId, `worker#${workerIndex}`, resolved, result.usage);
    repo.addActivity({
      taskId,
      intentId,
      role: `worker#${workerIndex}`,
      type: "message",
      title: `worker#${workerIndex} finished intent #${intentId}`,
      content: result.text?.slice(0, 4000) ?? "",
      data: { steps: result.steps.length, provider: resolved.provider, live: resolved.live },
    });
  } catch (error) {
    repo.addActivity({
      taskId,
      intentId,
      role: `worker#${workerIndex}`,
      type: "error",
      title: `worker#${workerIndex} failed intent #${intentId}`,
      content: error instanceof Error ? error.message : String(error),
    });
  } finally {
    const current = repo.getNode(intentId);
    if (current && ["running", "pending"].includes(current.status)) {
      repo.updateNodeStatus(intentId, "done");
    }
  }
}
