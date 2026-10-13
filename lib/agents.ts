import { ToolLoopAgent, stepCountIs, type ToolSet } from "ai";
import {
  buildPlannerTools,
  buildWorkerTools,
  buildDeadlineValidationTools,
  buildMcpAgentTools,
  plannerAssessmentSnapshot,
  type RunContext,
} from "./agent-tools";
import { resolveModel } from "./llm";
import * as repo from "./repo";
import type { Task } from "./types";

function recordUsage(
  taskId: number,
  role: string,
  resolved: { provider: string; modelId: string; live: boolean },
  usage: unknown,
) {
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

const PLANNER_INSTRUCTIONS = `You are AegisMind's COORDINATOR. You do not perform security assessment, reconnaissance, command execution, Python execution, validation probes, or finding write-back yourself. Specialist subagents are the only agents that perform assessment work. Your job is to plan, delegate, review their results, and coordinate the next specialist batch.

On every wake:
1. Own the persistent plan (todolist). If no plan exists, first call update_todolist with a concise phased plan: scope/discovery, independent authentication/authorization and input/SSRF review where relevant, then evidence/validation and summary. Create only steps relevant to this task. After saving a new plan, end this planner turn; dispatch on the next wake.
2. On every later wake, carefully review the complete exploration graph, scoped asset graph, findings, and specialist results supplied in the coordinator review. Reconcile result summaries against graph facts, anchors, asset relationships, and finding validation states before planning the next batch.
3. Delegate every assessment or evidence-gathering action to specialist subagents using dispatch_agents (or send_intent for one genuinely singular follow-up). Never attempt the assessment yourself. When valid in-scope work remains and no intent is already open for it, you MUST dispatch it in this turn rather than end with a status-only response.
4. Name each intent with its specialist function, such as "Discovery:", "Authentication/Authorization:", "SSRF:", or "Business Logic:". Give each subagent one bounded objective, the evidence to gather, safe handling constraints, and relevant explicitly in-scope asset IDs. Do not duplicate completed or open work.
5. Keep the todolist synchronized with delegated work. Mark steps done only when specialist results and graph evidence support completion; keep blocked/awaiting-approval work distinct from completed work.
6. Call prove_goal only after reviewing all three evidence collections and confirming no actionable or open work remains and the goal is supported by recorded evidence. Do not infer reachability, services, paths, or vulnerabilities from a target name.

Rules:
- One intent = one bounded objective anchored only to relevant in-scope assets.
- Never broaden the task's authorized scope. Every delegated intent must use relevant assets from the explicit task scope.
- Specialists perform recon and assessment, write back evidence, and use the validator only through its required explicit approval gate. Do not label a finding confirmed without a supporting validator result; unsupported vulnerability classes remain unverified.
- Never fabricate or modify evidence. Base decisions only on task input, graph contents, and recorded specialist results.`;

const WORKER_INSTRUCTIONS = `You are an autonomous specialist SOLVER in AegisMind. You claim exactly ONE coordinator-assigned intent and never expand its scope.

Workflow:
1. get_intent_context to load your specialization, objective, anchored endpoint, and task scope.
2. Before doing new work, search_all_worker_traces for keywords from your intent so you can reuse
   prior live evidence (do not treat unsupported claims as evidence).
3. Use execute_cmd and Python tools for reconnaissance as appropriate to the assigned specialist objective and explicitly authorized scope. These tools require no per-run approval, start from the workspace, time out after 60 seconds and cap output; they are not sandboxed. Do not claim commands or scripts succeeded without checking their returned exit code and output.
4. If a legacy intent names "Map attack surface", perform its reconnaissance with shell/Python tools; the dedicated mapping tool has been removed.
5. Do not invent services, endpoints, parameters, or security observations. Record the actual command/method and evidence for remote observations.
6. For a potential XSS or SQL error issue, submit the evidence-backed finding, then call validate_finding with its finding_id and the observed/justified parameter. It sends only a fixed safe probe to the anchored in-scope endpoint, only when enabled and explicitly approved. Do not use command execution to evade validation approval or task scope. For unsupported classes such as SSRF, record only an unverified potential finding with evidence; do not imply that the validator tested it or create an unsafe probe.
7. Write back only what is supported by evidence:
   - submit_asset for every new asset you observed (parent_id when known).
   - submit_fact for verified observations, anchored to the assets they concern.
   - For XSS and SQLi solver intents, call validate_finding on the anchored endpoint using an
     observed query parameter or a clearly labelled parameter guess (for example, "q"). This
     creates a potential candidate and requires manual approval before sending the validator's
     single bounded probe.
     Only a validator result of "confirmed" is confirmed; reflected-XSS remains potential because
     script execution is not tested. XXE and other unsupported classes stay unverified; do not
     craft invasive payloads.
   - submit_finding for other potential issues only when live observations support them. Every
     finding must include a description, safe reproduction steps, exact location, potential impact,
     and concrete evidence. When an actual safe, in-scope test produced a payload and result, include
     them as observed_payload and observed_result. These are reported evidence, not validator
     confirmation. Never use simulated or inferred data as proof.
8. finish_intent with a one-line summary that clearly states any unavailable evidence sources.

Rules:
- Do only your one intent. Do not invent new directions; that is the planner's job.
- Prefer concrete evidence over speculation. If a required tool is unavailable or fails, record what
  you could complete and finish the intent.`;

async function plannerPrompt(
  task: Task,
  recoverFromIdle: boolean,
): Promise<{ prompt: string; review: Awaited<ReturnType<typeof plannerAssessmentSnapshot>> }> {
  const [scope, intents, review] = await Promise.all([
    repo.listScopeAssets(task.id),
    repo.listNodes(task.id, "intent", 100),
    plannerAssessmentSnapshot(task.id),
  ]);
  const openIntents = intents.filter((intent) =>
    ["pending", "running", "awaiting_approval"].includes(intent.status),
  );
  const recentIntents = intents
    .filter((intent) => ["done", "blocked", "failed"].includes(intent.status))
    .slice(0, 20);
  const todolist = task.todolist ?? [];

  const prompt = [
    `Task: ${task.name}`,
    `Target: ${task.target}`,
    task.goal ? `Goal: ${task.goal}` : "Goal: determine the attack surface and record any findings.",
    task.description ? `Supporting assessment context:\n${task.description}` : "",
    "",
    "Explicit in-scope assets (use these IDs when creating intents):",
    ...(scope.length
      ? scope.slice(0, 100).map((asset) => `- id=${asset.id} kind=${asset.kind} value=${asset.value}`)
      : ["- None are currently attached to this task. Do not invent or expand scope."]),
    "",
    "Currently open intents:",
    ...(openIntents.length
      ? openIntents.slice(0, 30).map((intent) => `- #${intent.id} [${intent.status}] ${intent.title}`)
      : ["- None"]),
    "",
    "Recently completed or blocked intents (avoid repeating without a new evidence-based reason):",
    ...(recentIntents.length
      ? recentIntents.map((intent) => `- #${intent.id} [${intent.status}] ${intent.title}: ${(intent.content ?? "").slice(0, 240)}`)
      : ["- None"]),
    "",
    "Shared todolist:",
    ...(todolist.length
      ? todolist.map((item) => `- [${item.status}] ${item.id}: ${item.text}${item.depends_on?.length ? ` (depends on ${item.depends_on.join(", ")})` : ""}`)
      : ["- No steps recorded"]),
    "",
    "Fresh coordinator review of the current evidence. Read all three graphs/collections and reconcile specialist results before acting:",
    JSON.stringify(review),
    "",
    recoverFromIdle
      ? "Recovery: your previous coordinator turn produced no actionable delegation and did not prove the goal. Re-check the exploration graph, scoped asset graph, findings, and specialist results. If no todolist exists, call update_todolist to save the phased plan and end this turn. Otherwise you MUST update the plan and dispatch the next relevant, uncovered in-scope assessment work with dispatch_agents (or send_intent for one singular follow-up). Do not perform the assessment yourself or respond with only a status/pause recommendation. If scope is absent, do not fabricate assets; report the missing scope."
      : "Coordinator cycle: if no todolist exists, call update_todolist to create the phased plan and end this turn; dispatch is gated until that plan is saved. Otherwise review the exploration graph, scoped asset graph, findings, and specialist results. If relevant in-scope work remains and no matching intent is open, update the plan and MUST delegate it with dispatch_agents (or send_intent for one singular follow-up). If matching intents are open, do not duplicate them; reconcile their outcomes and prepare any complementary delegation. You never execute assessment work yourself.",
    "Do not claim an asset was tested or a security goal proved without supporting specialist results and graph evidence.",
  ].join("\n");
  return { prompt, review };
}

function specialistAgentName(intentTitle?: string): string {
  const title = intentTitle ?? "";
  const prefix = title.match(/^\s*([^:]{1,48}):/)?.[1]?.trim();
  const classification: Array<[string, RegExp]> = [
    ["SSRF", /\bssrf\b/i],
    ["Discovery", /\b(discovery|recon|enumerat|map attack surface)\b/i],
    ["Authentication/Authorization", /\b(auth|authentication|authorization|access control)\b/i],
    ["Business Logic", /\b(business logic|workflow abuse)\b/i],
    ["XSS", /\b(xss|cross.site scripting)\b/i],
    ["SQL Injection", /\b(sql.?i|sql injection)\b/i],
  ];
  const role = classification.find(([, pattern]) => pattern.test(prefix ?? title))?.[0] ?? prefix;
  if (!role) return "Specialist assessment agent";
  return `${role.replace(/\s+agent$/i, "")} agent`;
}

async function workerPrompt(task: Task, intentId: number): Promise<string> {
  const intent = await repo.getNode(intentId);
  return [
    `Task: ${task.name} (target ${task.target})`,
    task.description ? `Supporting assessment context:\n${task.description}` : "",
    `Role: ${specialistAgentName(intent?.title)}; treat the assigned intent as your only objective.`,
    `Your intent #${intentId}: ${intent?.title ?? "(unknown)"}`,
    intent?.content ? `Details: ${intent.content}` : "",
    "",
    "In-scope assets:",
    "(in-scope assets loaded at wake time)",
    "",
    "Execute this one intent, write your observations back to both graphs, then finish_intent.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runPlannerTurn(
  taskId: number,
  options: { recoverFromIdle?: boolean; abortSignal?: AbortSignal } = {},
): Promise<{ proved: boolean; live: boolean; provider: string }> {
  const task = await repo.getTask(taskId);
  if (!task) return { proved: false, live: false, provider: "none" };

  const ctx: RunContext = { task, role: "planner" };
  const tools = {
    ...buildPlannerTools(ctx),
    ...await buildMcpAgentTools(ctx, "planner"),
  } as unknown as ToolSet;
  const settings = await repo.getSystemSettings();
  const resolved = await resolveModel();

  const agent = new ToolLoopAgent({
    id: "planner",
    model: resolved.model,
    instructions: PLANNER_INSTRUCTIONS,
    tools,
    stopWhen: stepCountIs(settings.plannerMaxSteps),
  });

  await repo.addActivity({ taskId, role: "planner", type: "wake", title: "planner wake" });
  const goalBefore = (await repo.listNodes(taskId, "goal", 1))[0];
  const plannerContext = await plannerPrompt(task, options.recoverFromIdle ?? false);
  await repo.addActivity({
    taskId,
    role: "planner",
    type: "graph_read",
    title: "planner reviewed exploration graph, asset graph, and findings",
    content: `Reviewed ${plannerContext.review.explorationGraph.nodes.length} exploration nodes, ${plannerContext.review.assetGraph.nodes.length} in-scope assets, ${plannerContext.review.findings.length} findings, and ${plannerContext.review.workerResults.length} specialist activity records.`,
    data: {
      exploration_nodes: plannerContext.review.explorationGraph.nodes.length,
      asset_nodes: plannerContext.review.assetGraph.nodes.length,
      findings: plannerContext.review.findings.length,
      worker_results: plannerContext.review.workerResults.length,
    },
  });
  const result = await agent.generate({
    prompt: plannerContext.prompt,
    abortSignal: options.abortSignal,
  });
  await recordUsage(taskId, "planner", resolved, result.usage);
  const goalAfter = (await repo.listNodes(taskId, "goal", 1))[0];

  await repo.addActivity({
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
  abortSignal?: AbortSignal,
): Promise<void> {
  const task = await repo.getTask(taskId);
  if (!task) return;

  const intent = await repo.getNode(intentId);
  const agentName = specialistAgentName(intent?.title);
  await repo.updateNodeStatus(intentId, "running");
  const ctx: RunContext = { task, role: "worker", intentId, workerIndex, agentName };
  const tools = {
    ...buildWorkerTools(ctx),
    ...await buildMcpAgentTools(ctx, "subagent"),
  } as unknown as ToolSet;
  const settings = await repo.getSystemSettings();

  try {
    const resolved = await resolveModel();
    const agent = new ToolLoopAgent({
      id: `worker-${workerIndex}`,
      model: resolved.model,
      instructions: WORKER_INSTRUCTIONS,
      tools,
      stopWhen: stepCountIs(settings.workerMaxSteps),
    });
    const result = await agent.generate({ prompt: await workerPrompt(task, intentId), abortSignal });
    await recordUsage(taskId, `worker#${workerIndex}`, resolved, result.usage);
    await repo.addActivity({
      taskId,
      intentId,
      role: agentName,
      type: "message",
      title: `${agentName} finished intent #${intentId}`,
      content: result.text?.slice(0, 4000) ?? "",
      data: { steps: result.steps.length, provider: resolved.provider, live: resolved.live },
    });
  } catch (error) {
    await repo.updateNodeStatus(intentId, "failed");
    await repo.addActivity({
      taskId,
      intentId,
      role: agentName,
      type: "error",
      title: `${agentName} failed intent #${intentId}`,
      content: error instanceof Error ? error.message : String(error),
    });
  } finally {
    const current = await repo.getNode(intentId);
    if (current && ["running", "pending"].includes(current.status)) {
      await repo.updateNodeStatus(intentId, "done");
    }
  }

}

export async function runDeadlineValidationTurn(
  taskId: number,
  intentId: number,
  validationCandidates: Array<{
    findingId: number;
    type: "reflected_xss" | "sql_error";
    parameter: string;
  }>,
): Promise<void> {
  const task = await repo.getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} was not found during deadline validation`);
  const intent = await repo.getNode(intentId);
  if (!intent) throw new Error(`Deadline-validation intent ${intentId} was not found`);

  const findings = await Promise.all(validationCandidates.map(({ findingId }) => repo.getFinding(findingId)));
  const candidates = validationCandidates.flatMap((candidate, index) => {
    const finding = findings[index];
    return finding?.validator_status === "unverified"
      ? [{
          finding_id: finding.id,
          title: finding.title,
          type: candidate.type,
          parameter: candidate.parameter,
        }]
      : [];
  });

  const ctx: RunContext = {
    task,
    role: "worker",
    intentId,
    workerIndex: 0,
    agentName: "Deadline validation agent",
  };
  const tools = buildDeadlineValidationTools(ctx) as unknown as ToolSet;
  const settings = await repo.getSystemSettings();
  const resolved = await resolveModel();
  const agent = new ToolLoopAgent({
    id: "deadline-validation",
    model: resolved.model,
    instructions:
      "You are AegisMind's deadline validation agent. The assessment window has ended. Do not perform reconnaissance, run commands, create findings, or expand scope. Use only the validate_finding tool for listed findings, with exactly the supplied type and parameter derived from the finding's recorded vulnerability class and exact location. Do not infer or change either value. Each probe requires explicit operator approval and is bounded by the validator. Findings without a supported class and exact parameter are not listed and remain unverified in the report.",
    tools,
    stopWhen: stepCountIs(settings.workerMaxSteps),
  });
  const result = await agent.generate({
    prompt: [
      `Task: ${task.name}`,
      `Deadline-validation intent: ${intent.title}`,
      "Validate each listed finding using the supplied type and parameter, which were derived from the recorded vulnerability class and exact location. Do not call any other tools.",
      JSON.stringify(candidates),
    ].join("\n"),
  });
  await recordUsage(taskId, "deadline_validation", resolved, result.usage);
  await repo.addActivity({
    taskId,
    intentId,
    role: "Deadline validation agent",
    type: "message",
    title: "deadline validation finished",
    content: result.text?.slice(0, 4000) ?? "",
    data: { finding_ids: candidates.map((candidate) => candidate.finding_id), steps: result.steps.length },
  });
  await repo.updateNodeStatus(intentId, "done");
}
