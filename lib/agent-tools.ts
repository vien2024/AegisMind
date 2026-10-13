import { tool } from "ai";
import { z } from "zod";
import { emitEvent } from "./events";
import {
  runWorkspaceCommand,
  runWorkspacePythonFile,
  writeWorkspacePythonFile,
} from "./command-runner";
import * as repo from "./repo";
import { callMcpTool, listMcpServers, type McpAgentTarget } from "./mcp";
import { extractHost } from "./simulate";
import { ASSET_KINDS, NODE_KINDS, SEVERITIES, type Asset, type Task } from "./types";
import {
  assessValidationResponse,
  craftValidationPayload,
  sendValidationProbe,
  VALIDATOR_TYPES,
} from "./validator";

export interface RunContext {
  task: Task;
  role: "planner" | "worker" | "mainagent";
  intentId?: number;
  workerIndex?: number;
  agentName?: string;
}

function activityRole(ctx: RunContext): string {
  if (ctx.role !== "worker") return ctx.role;
  return ctx.agentName ?? "Specialist assessment agent";
}

async function logActivity(
  ctx: RunContext,
  input: { type: string; title: string; content?: string; data?: Record<string, unknown>; step?: number },
): Promise<void> {
  await repo.addActivity({
    taskId: ctx.task.id,
    intentId: ctx.intentId ?? null,
    step: input.step ?? null,
    role: activityRole(ctx),
    type: input.type,
    title: input.title,
    content: input.content,
    data: input.data,
  });
  emitEvent({ type: "activity", taskId: ctx.task.id, payload: { title: input.title, role: activityRole(ctx) } });
}

/** Approval gate: every tool that would "touch" an asset passes through this. */
async function guard(
  ctx: RunContext,
  toolName: string,
  args: Record<string, unknown>,
  forceManual = false,
) {
  // Honour a decision that was already made for this intent + tool so an
  // approved call is not re-queued on every wake.
  const decided = await repo.findDecidedApproval(ctx.task.id, ctx.intentId ?? null, toolName);
  if (decided) {
    if (decided.status === "denied") return { approved: false as const, denialId: decided.id };
    return { approved: true as const };
  }

  const autoApprove = ctx.task.auto_approve === 1;
  if (autoApprove && !forceManual) {
    const approval = await repo.createApproval({
      taskId: ctx.task.id,
      intentId: ctx.intentId ?? null,
      tool: toolName,
      args,
      reason: "auto-approved by task policy",
      status: "auto_approved",
    });
    return { approved: true as const };
  }
  const approval = await repo.createApproval({
    taskId: ctx.task.id,
    intentId: ctx.intentId ?? null,
    tool: toolName,
    args,
    reason: forceManual
      ? "Live vulnerability validation requires explicit approval before one bounded GET request."
      : "task requires manual interception approval",
    status: "pending",
  });
  if (ctx.intentId) await repo.updateNodeStatus(ctx.intentId, "awaiting_approval");
  emitEvent({ type: "approval", taskId: ctx.task.id, payload: { approvalId: approval.id, tool: toolName } });
  return { approved: false as const, approvalId: approval.id };
}

async function waitForApproval(
  taskId: number,
  approvalId: number,
  allowCompletedTask = false,
): Promise<"approved" | "denied" | "cancelled" | "timed_out"> {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const approval = (await repo.listApprovals(taskId)).find((entry) => entry.id === approvalId);
    if (approval?.status === "approved") return "approved";
    if (approval?.status === "denied") return "denied";
    const task = await repo.getTask(taskId);
    if (!task || ["paused", "stopped", "failed"].includes(task.status) || (!allowCompletedTask && task.status === "completed")) {
      return "cancelled";
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return "timed_out";
}

export function createCommandExecutionTool(ctx: RunContext) {
  return tool({
      description:
        "Run a shell command from the AegisMind workspace without a per-run approval. This is unrestricted command execution, not a sandbox. Commands time out after 60 seconds and returned output is capped.",
      inputSchema: z.object({
        command: z.string().trim().min(1).max(4_000),
      }),
      execute: async ({ command }) => {
        const cwd = process.cwd();
        const result = await runWorkspaceCommand(command);
        const content = [
          `exit code: ${result.exitCode ?? "unavailable"}`,
          result.stdout ? `stdout:\n${result.stdout}` : "",
          result.stderr ? `stderr:\n${result.stderr}` : "",
          result.error ? `error: ${result.error}` : "",
        ].filter(Boolean).join("\n");
        await logActivity(ctx, {
          type: "command",
          title: `command ${result.ok ? "completed" : "failed"}: ${command}`,
          content,
          data: { command, cwd, exit_code: result.exitCode, ok: result.ok },
        });
        emitEvent({
          type: "activity",
          taskId: ctx.task.id,
          payload: { title: `command ${result.ok ? "completed" : "failed"}` },
        });
        return result;
      },
  });
}

export function createPythonTools(ctx: RunContext) {
  return {
    write_python_file: tool({
      description:
        "Create or replace a Python source file in agent-python inside the workspace. No per-run approval is required. Only a simple .py filename is accepted; source is limited to 64 KB.",
      inputSchema: z.object({
        file_name: z.string().min(4).max(104),
        source: z.string().max(64_000),
      }),
      execute: async ({ file_name, source }) => {
        const relativePath = await writeWorkspacePythonFile(file_name, source);
        await logActivity(ctx, {
          type: "python_file",
          title: `Python file written: ${relativePath}`,
          content: source.slice(0, 4_000),
          data: { file_name: relativePath, source_length: source.length },
        });
        return { ok: true, file: relativePath, source_length: source.length };
      },
    }),
    run_python_file: tool({
      description:
        "Run a Python file previously created in agent-python inside the workspace. No per-run approval is required. Execution has a 60-second timeout and returned output is capped; it is not sandboxed.",
      inputSchema: z.object({ file_name: z.string().min(4).max(104) }),
      execute: async ({ file_name }) => {
        const result = await runWorkspacePythonFile(file_name);
        const content = [
          `exit code: ${result.exitCode ?? "unavailable"}`,
          result.stdout ? `stdout:\n${result.stdout}` : "",
          result.stderr ? `stderr:\n${result.stderr}` : "",
          result.error ? `error: ${result.error}` : "",
        ].filter(Boolean).join("\n");
        await logActivity(ctx, {
          type: "python_run",
          title: `Python script ${result.ok ? "completed" : "failed"}: ${file_name}`,
          content,
          data: {
            file_name,
            cwd: result.cwd,
            exit_code: result.exitCode,
            ok: result.ok,
          },
        });
        return result;
      },
    }),
  };
}

export async function buildMcpAgentTools(ctx: RunContext, target: McpAgentTarget) {
  const servers = (await listMcpServers()).filter((server) => server.agent_target === target);
  const tools = servers.flatMap((server) =>
    server.tools.map((descriptor, index) => {
      const safeToolName = descriptor.name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48);
      const toolName = `mcp_${server.id}_${index + 1}_${safeToolName || "tool"}`;
      const approvalTool = `mcp:${server.id}:${descriptor.name}`;
      const schemaDescription = JSON.stringify(descriptor.inputSchema).slice(0, 4_000);
      return [
        toolName,
        tool({
          description: [
            `Call ${descriptor.name} on the MCP server "${server.name}".`,
            descriptor.description ?? "",
            `Input JSON Schema: ${schemaDescription}`,
            "This call requires operator approval before it is sent.",
          ].filter(Boolean).join("\n"),
          inputSchema: z.record(z.string(), z.unknown()),
          execute: async (args) => {
            const approval = await repo.createApproval({
              taskId: ctx.task.id,
              intentId: ctx.intentId ?? null,
              tool: approvalTool,
              args: {
                server_id: server.id,
                server_name: server.name,
                tool_name: descriptor.name,
                arguments: args,
              },
              reason: `MCP tool call to ${server.name}.${descriptor.name} requires explicit operator approval.`,
              status: "pending",
            });
            if (ctx.intentId) await repo.updateNodeStatus(ctx.intentId, "awaiting_approval");
            emitEvent({
              type: "approval",
              taskId: ctx.task.id,
              payload: { approvalId: approval.id, tool: approvalTool },
            });

            const decision = await waitForApproval(ctx.task.id, approval.id);
            if (decision !== "approved") {
              if (decision !== "denied") {
                await repo.setApprovalStatus(approval.id, "denied");
              }
              const reason = decision === "denied"
                ? "Operator denied the MCP call; it was not sent."
                : decision === "timed_out"
                  ? "MCP call approval timed out; the call was not sent."
                  : "The task stopped before MCP call approval; the call was not sent.";
              await logActivity(ctx, {
                type: "mcp",
                title: `MCP call not sent: ${server.name}.${descriptor.name}`,
                content: reason,
                data: { server_id: server.id, tool_name: descriptor.name, approval_id: approval.id, decision },
              });
              return { status: decision, error: reason };
            }

            try {
              const result = await callMcpTool(server, descriptor.name, args);
              await logActivity(ctx, {
                type: "mcp",
                title: `MCP call completed: ${server.name}.${descriptor.name}`,
                content: JSON.stringify(result).slice(0, 4_000),
                data: { server_id: server.id, tool_name: descriptor.name, approval_id: approval.id },
              });
              return result;
            } catch (error) {
              await logActivity(ctx, {
                type: "error",
                title: `MCP call failed: ${server.name}.${descriptor.name}`,
                content: error instanceof Error ? error.message : String(error),
                data: { server_id: server.id, tool_name: descriptor.name, approval_id: approval.id },
              });
              throw error;
            }
          },
        }),
      ] as const;
    }),
  );
  return Object.fromEntries(tools);
}

/* ------------------------------------------------------------------ */
/* Shared graph readers                                                */
/* ------------------------------------------------------------------ */

export async function coverageSnapshot(taskId: number) {
  const scope = await repo.listScopeAssets(taskId);
  const tested = new Set<number>();
  for (const asset of scope) {
    const nodes = await repo.listNodeIdsForAsset(asset.id);
    for (const n of nodes) {
      const node = await repo.getNode(n);
      if (node && ["intent", "fact", "finding"].includes(node.kind)) tested.add(asset.id);
    }
  }
  return scope.map((a) => ({ id: a.id, kind: a.kind, value: a.value, tested: tested.has(a.id) }));
}

export async function graphOverview(taskId: number) {
  const nodes = await repo.listNodes(taskId, undefined, 1000);
  const counts: Record<string, number> = Object.fromEntries(NODE_KINDS.map((k) => [k, 0]));
  for (const n of nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
  const openIntents = nodes
    .filter((n) => n.kind === "intent" && ["pending", "running", "blocked", "awaiting_approval"].includes(n.status))
    .map((n) => ({ id: n.id, title: n.title, status: n.status }));
  const facts = nodes.filter((n) => n.kind === "fact").slice(0, 10).map((n) => ({ id: n.id, title: n.title }));
  const findings = (await repo.listFindings(taskId)).slice(0, 30).map((finding) => ({
    id: finding.id,
    title: finding.title,
    severity: finding.severity,
    status: finding.status,
    validator_status: finding.validator_status,
    validator_result: finding.validator_result,
    asset_id: finding.asset_id,
    location: finding.location,
  }));
  const workerUpdates = (await repo.listActivity(taskId, 120))
    .filter((entry) => entry.intent_id !== null)
    .slice(-30)
    .map((entry) => ({
      intent_id: entry.intent_id,
      role: entry.role,
      type: entry.type,
      title: entry.title,
      content: (entry.content ?? "").slice(0, 1200),
    }));
  const goal = nodes.find((n) => n.kind === "goal");
  return {
    counts,
    openIntents,
    recentFacts: facts,
    findings,
    workerUpdates,
    goal: goal ? { id: goal.id, status: goal.status, title: goal.title } : null,
  };
}

export async function plannerAssessmentSnapshot(taskId: number) {
  const [nodes, edges, scope, findings, activity] = await Promise.all([
    repo.listNodes(taskId, undefined, 1000),
    repo.listEdges(taskId),
    repo.listScopeAssets(taskId),
    repo.listFindings(taskId),
    repo.listActivity(taskId, 120),
  ]);
  const anchors = await repo.listAnchorsForNodes(nodes.map((node) => node.id));
  const anchorsByNode = new Map<number, number[]>();
  for (const anchor of anchors) {
    const assetIds = anchorsByNode.get(anchor.node_id) ?? [];
    assetIds.push(anchor.asset_id);
    anchorsByNode.set(anchor.node_id, assetIds);
  }
  const scopeIds = new Set(scope.map((asset) => asset.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const workerResults = activity
    .filter((entry) => entry.intent_id !== null)
    .slice(-40)
    .map((entry) => ({
      intent_id: entry.intent_id,
      intent_title: nodesById.get(entry.intent_id!)?.title ?? null,
      role: entry.role,
      type: entry.type,
      title: entry.title,
      content: (entry.content ?? "").slice(0, 1600),
    }));

  return {
    explorationGraph: {
      nodes: nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        title: node.title,
        status: node.status,
        content: node.content,
        data: node.data,
      })),
      edges,
      anchors: nodes.map((node) => ({
        node_id: node.id,
        asset_ids: anchorsByNode.get(node.id) ?? [],
      })),
    },
    assetGraph: {
      nodes: scope.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        value: asset.value,
        parent_id: asset.parent_id,
      })),
      edges: scope
        .filter((asset) => asset.parent_id !== null && scopeIds.has(asset.parent_id))
        .map((asset) => ({
          from_id: asset.parent_id,
          to_id: asset.id,
          relation: "parent_of",
        })),
    },
    findings: findings.map((finding) => ({
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
      validator_status: finding.validator_status,
      validator_result: finding.validator_result,
      asset_id: finding.asset_id,
      location: finding.location,
      description: finding.description,
      evidence: (finding.evidence ?? "").slice(0, 1600),
      observed_payload: finding.observed_payload,
      observed_result: finding.observed_result,
    })),
    workerResults,
  };
}

/* ------------------------------------------------------------------ */
/* Planner tools                                                       */
/* ------------------------------------------------------------------ */

interface PlannerIntentInput {
  title: string;
  description: string;
  asset_ids: number[];
}

async function createPlannerIntent(ctx: RunContext, input: PlannerIntentInput) {
  const { title, description, asset_ids } = input;
  const task = await repo.getTask(ctx.task.id);
  if (!task?.todolist?.length) {
    return {
      created: false,
      reason: "create the task's phased todolist first; dispatch work on the next planner turn",
    };
  }
  const nodes = await repo.listNodes(ctx.task.id, "intent", 1000);
  const scope = await repo.listScopeAssets(ctx.task.id);
  if (asset_ids.some((assetId) => !scope.some((asset) => asset.id === assetId))) {
    return { created: false, reason: "intents may only target assets in the task's explicit scope" };
  }
  if (/^Solver (XSS|SQLi|XXE):/.test(title)) {
    if (asset_ids.length !== 1) {
      return { created: false, reason: "specialist solver intents must target exactly one asset" };
    }
    const asset = await repo.getAsset(asset_ids[0]!);
    if (!asset || (asset.kind !== "endpoint" && !/^https?:\/\//i.test(asset.value))) {
      return { created: false, reason: "specialist solver intents must target an HTTP endpoint" };
    }
  }
  for (const node of nodes) {
    if (node.status === "failed" || node.title !== title) continue;
    const anchored = await repo.listAnchoredAssetIds(node.id);
    if (asset_ids.every((assetId) => anchored.includes(assetId))) {
      return {
        created: false,
        intent_id: node.id,
        reason: "an intent with this title and scope already exists; review its result instead of duplicating it",
      };
    }
  }
  const node = await repo.createNode({
    taskId: ctx.task.id,
    kind: "intent",
    title,
    content: description,
    status: "pending",
    data: { source: "planner" },
  });
  await repo.addAnchor(node.id, asset_ids);
  const goal = (await repo.listNodes(ctx.task.id, "goal", 1))[0];
  if (goal) await repo.addEdge(ctx.task.id, goal.id, node.id, "spawns");
  await logActivity(ctx, {
    type: "intent_sent",
    title: `planner dispatched intent #${node.id}: ${title}`,
    content: description,
    data: { asset_ids },
  });
  emitEvent({ type: "intent", taskId: ctx.task.id, payload: { intentId: node.id, title } });
  return { created: true, intent_id: node.id };
}

export function buildPlannerTools(ctx: RunContext) {
  return {
    get_graph_overview: tool({
      description:
        "Read the current state of the two graphs: node counts, open intents, recent facts and whether the goal is proven.",
      inputSchema: z.object({}),
      execute: async () => {
        const overview = await graphOverview(ctx.task.id);
        await logActivity(ctx, { type: "graph_read", title: "planner read graph overview", data: { counts: overview.counts } });
        return overview;
      },
    }),
    get_coverage: tool({
      description:
        "List the in-scope assets for this task and whether each one has already been tested (intent/fact/finding anchored to it).",
      inputSchema: z.object({}),
      execute: async () => {
        const coverage = await coverageSnapshot(ctx.task.id);
        const tested = coverage.filter((c) => c.tested).length;
        await logActivity(ctx, { type: "graph_read", title: `planner read coverage: ${tested}/${coverage.length} assets tested` });
        return { total: coverage.length, tested, assets: coverage };
      },
    }),
    read_todolist: tool({
      description:
        "Read the shared, per-task planning todolist that persists across planner wakes. Use it to keep a multi-step attack chain stable.",
      inputSchema: z.object({}),
      execute: async () => ({ items: (await repo.getTask(ctx.task.id))?.todolist ?? [] }),
    }),
    update_todolist: tool({
      description:
        "Replace the shared planning todolist. Mark prerequisites-met steps as done and the next actionable step as in_progress before sending its intent.",
      inputSchema: z.object({
        items: z.array(
          z.object({
            id: z.string(),
            text: z.string(),
            status: z.enum(["pending", "in_progress", "done", "blocked"]),
            depends_on: z.array(z.string()).optional(),
          }),
        ),
      }),
      execute: async ({ items }) => {
        await repo.updateTask(ctx.task.id, { todolist: items });
        await logActivity(ctx, { type: "todolist", title: `planner updated todolist (${items.length} steps)`, data: { items } });
        emitEvent({ type: "todolist", taskId: ctx.task.id, payload: { items } });
        return { ok: true, items };
      },
    }),
    send_intent: tool({
      description:
        "Send one bounded worker objective anchored to explicitly in-scope assets. Prefer dispatch_agents to create a parallel batch of independent specialist work.",
      inputSchema: z.object({
        title: z.string().describe("Short imperative title, e.g. 'Enumerate subdomains of example.com'"),
        description: z.string().describe("What the worker should determine and why it advances the goal."),
        asset_ids: z.array(z.number()).min(1).describe("Assets this direction probes; these anchor the intent."),
      }),
      execute: async (input) => createPlannerIntent(ctx, input),
    }),
    dispatch_agents: tool({
      description:
        "Dispatch 1-8 independent specialist worker intents in one batch. Use distinct roles such as Discovery, Authentication/Authorization, Input/SSRF, or Business Logic when relevant. Anchor each to relevant in-scope assets. The engine runs the batch concurrently up to the task concurrency setting.",
      inputSchema: z.object({
        intents: z.array(z.object({
          title: z.string().trim().min(1).max(200),
          description: z.string().trim().min(1).max(4000),
          asset_ids: z.array(z.number().int().positive()).min(1).max(20),
        })).min(1).max(8),
      }),
      execute: async ({ intents }) => {
        const results = [];
        for (const intent of intents) {
          results.push(await createPlannerIntent(ctx, intent));
        }
        const dispatched = results.filter((result) => result.created).length;
        await logActivity(ctx, {
          type: "dispatch",
          title: `planner dispatched ${dispatched}/${intents.length} specialist intents`,
          data: { results },
        });
        return { dispatched, requested: intents.length, results };
      },
    }),
    prove_goal: tool({
      description:
        "Call only when every reachable direction has been explored and the goal conclusion can be stated. Ends the task.",
      inputSchema: z.object({ conclusion: z.string() }),
      execute: async ({ conclusion }) => {
        const goal = (await repo.listNodes(ctx.task.id, "goal", 1))[0];
        if (goal) await repo.updateNodeStatus(goal.id, "done");
        await repo.addActivity({
          taskId: ctx.task.id,
          role: "planner",
          type: "goal_proven",
          title: "planner proved the goal",
          content: conclusion,
        });
        emitEvent({ type: "goal", taskId: ctx.task.id, payload: { conclusion } });
        return { proven: true, conclusion };
      },
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Worker tools                                                        */
/* ------------------------------------------------------------------ */

async function intentAssets(intentId: number): Promise<Asset[]> {
  const ids = await repo.listAnchoredAssetIds(intentId);
  const assets = await Promise.all(ids.map((id) => repo.getAsset(id)));
  return assets.filter((a): a is Asset => a != null);
}

export function buildWorkerTools(ctx: RunContext) {
  return {
    execute_cmd: createCommandExecutionTool(ctx),
    ...createPythonTools(ctx),
    get_intent_context: tool({
      description: "Read this worker's claimed intent, its anchored assets and the current in-scope assets.",
      inputSchema: z.object({}),
      execute: async () => {
        const intent = await repo.getNode(ctx.intentId!);
        return {
          intent: intent ? { id: intent.id, title: intent.title, description: intent.content } : null,
          anchored_assets: (await intentAssets(ctx.intentId!)).map((a) => ({ id: a.id, kind: a.kind, value: a.value })),
          scope: (await repo.listScopeAssets(ctx.task.id)).map((a) => ({ id: a.id, kind: a.kind, value: a.value })),
        };
      },
    }),
    list_scope: tool({
      description: "List the in-scope assets of the task.",
      inputSchema: z.object({}),
      execute: async () => (await repo.listScopeAssets(ctx.task.id)).map((a) => ({ id: a.id, kind: a.kind, value: a.value })),
    }),
    search_all_worker_traces: tool({
      description:
        "Keyword-search the execution process of other workers in this task (your own steps are excluded). Use it to reuse in-process observations before duplicating work.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const settings = await repo.getSystemSettings();
        const hits = await repo.searchWorkerTraces(ctx.task.id, query, ctx.intentId, settings.traceSearchLimit);
        return hits.map((h) => ({ intent_id: h.intent_id, step: h.step, title: h.title, snippet: (h.content ?? "").slice(0, 200) }));
      },
    }),
    list_worker_traces: tool({
      description: "List the intents that have produced execution steps in this task.",
      inputSchema: z.object({}),
      execute: async () => await repo.listWorkerIntentIds(ctx.task.id),
    }),
    get_worker_trace: tool({
      description: "Fetch the full recorded steps of another worker's intent to exchange detailed process information.",
      inputSchema: z.object({
        intent_id: z.number(),
        step_ids: z.array(z.number()).optional(),
      }),
      execute: async ({ intent_id, step_ids }) => {
        const steps = await repo.listIntentActivity(intent_id);
        const filtered = step_ids ? steps.filter((s) => step_ids.includes(s.id)) : steps;
        return filtered.map((s) => ({ id: s.id, step: s.step, title: s.title, content: s.content }));
      },
    }),
    validate_finding: tool({
      description:
        "Validate a potential finding with one bounded GET probe. Supply an existing finding_id or create an unverified candidate by supplying its in-scope asset_id. The validator crafts the payload, records the candidate and result, and always waits for manual operator approval. SQL syntax-error responses can confirm SQL injection; reflected-XSS canaries are only potential because script execution is never performed.",
      inputSchema: z.object({
        finding_id: z.number().int().positive().optional(),
        asset_id: z.number().int().positive().optional(),
        type: z.enum(VALIDATOR_TYPES),
        parameter: z.string().trim().min(1).max(64),
      }),
      execute: async ({ finding_id, asset_id, type, parameter }) => {
        if (process.env.AEGISMIND_ENABLE_LIVE_VALIDATION !== "true") {
          return { error: "Live validation is disabled. Set AEGISMIND_ENABLE_LIVE_VALIDATION=true to enable approved probes." };
        }
        let finding = finding_id ? await repo.getFinding(finding_id) : undefined;
        if (finding_id && (!finding || finding.task_id !== ctx.task.id || !finding.asset_id)) {
          return { error: "The finding must belong to this task and reference an in-scope endpoint." };
        }
        if (!finding && !asset_id) {
          return { error: "Provide either a task finding_id or an in-scope asset_id for a new candidate." };
        }
        if (finding && asset_id !== undefined && finding.asset_id !== asset_id) {
          return { error: "The supplied asset_id does not match the finding's endpoint." };
        }
        const candidateAssetId = finding?.asset_id ?? asset_id;
        if (candidateAssetId === undefined) {
          return { error: "An in-scope endpoint asset is required." };
        }
        const asset = await repo.getAsset(candidateAssetId);
        const scope = await repo.listScopeAssets(ctx.task.id);
        const anchoredIds = ctx.intentId ? await repo.listAnchoredAssetIds(ctx.intentId) : [];
        if (
          !asset ||
          asset.kind !== "endpoint" ||
          !scope.some((entry) => entry.id === asset.id) ||
          (ctx.intentId !== undefined && !anchoredIds.includes(asset.id))
        ) {
          return {
            error: ctx.intentId
              ? "The endpoint must be explicitly in scope and anchored to this intent."
              : "The endpoint must be explicitly in scope for this task.",
          };
        }

        let target: URL;
        try {
          target = new URL(asset.value);
        } catch {
          return { error: "The in-scope endpoint is not a valid absolute URL." };
        }
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          return { error: "Only HTTP and HTTPS endpoint assets can be validated." };
        }
        if (target.username || target.password || target.hash) {
          return { error: "Endpoint URLs cannot include credentials or fragments." };
        }
        if (target.toString().length > 2_048) {
          return { error: "Endpoint URLs cannot exceed 2,048 characters." };
        }
        if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(parameter)) {
          return { error: "The query parameter name is invalid." };
        }
        const endpointLocation = `${target.origin}${target.pathname}`;
        let createdCandidate = false;
        if (!finding) {
          const title = `${type === "reflected_xss" ? "Reflected XSS" : "SQL error injection"} candidate (${parameter}) at ${endpointLocation}`;
          finding = (await repo.listFindings(ctx.task.id)).find(
            (entry) => entry.asset_id === asset.id && entry.title === title,
          );
          if (!finding) {
            const description =
              type === "reflected_xss"
                ? "Potential reflected script injection candidate; validation is required before confirming XSS."
                : "Potential SQL error-injection candidate; validation is required before confirming SQL injection.";
            const node = await repo.createNode({
              taskId: ctx.task.id,
              kind: "finding",
              title,
              content: description,
              status: "done",
              data: { severity: "medium", validator_type: type, validator_parameter: parameter },
            });
            await repo.addAnchor(node.id, [asset.id]);
            if (ctx.intentId) await repo.addEdge(ctx.task.id, ctx.intentId, node.id, "yields");
            finding = await repo.createFinding({
              taskId: ctx.task.id,
              assetId: asset.id,
              nodeId: node.id,
              title,
              severity: "medium",
              description,
              reproduction: `Send a GET request to ${endpointLocation} with query parameter "${parameter}" set to the validator-generated payload.`,
              location: `${endpointLocation} query parameter "${parameter}"`,
              impact:
                type === "reflected_xss"
                  ? "If the reflected value executes as script in a browser, an attacker may run code in a victim's session."
                  : "If the parameter is interpreted as SQL, an attacker may affect the application's database query.",
              evidence: "Unverified candidate created for a bounded validator probe; this is not proof of a vulnerability.",
            });
            createdCandidate = true;
          }
        }
        if (!["unverified", "awaiting_approval"].includes(finding.validator_status)) {
          return {
            finding_id: finding.id,
            status: finding.validator_status,
            result: finding.validator_result,
            message: "This finding already has a validation result; create a new finding to run a separate check.",
          };
        }
        const payload = craftValidationPayload({
          taskId: ctx.task.id,
          intentId: ctx.intentId ?? 0,
          findingId: finding.id,
          parameter,
          type,
        });
        const approvalUrl = new URL(target);
        for (const name of new Set(approvalUrl.searchParams.keys())) {
          if (name !== parameter) approvalUrl.searchParams.set(name, "[redacted]");
        }
        approvalUrl.searchParams.set(parameter, payload);
        const toolKey = `validate_finding_${finding.id}_${type}_${parameter}`;
        await repo.recordFindingValidation({
          findingId: finding.id,
          type,
          parameter,
          payload,
          status: "awaiting_approval",
          result: "Waiting for manual approval; no request has been sent.",
        });
        emitEvent({
          type: "finding",
          taskId: ctx.task.id,
          payload: { findingId: finding.id, validationStatus: "awaiting_approval" },
        });
        const approval = await guard(
          ctx,
          toolKey,
          {
            finding_id: finding.id,
            asset_id: asset.id,
            endpoint: `${target.origin}${target.pathname}`,
            method: "GET",
            type,
            parameter,
            payload,
            request_url: approvalUrl.toString(),
          },
          true,
        );
        if (!approval.approved) {
          const decision = approval.denialId
            ? "denied"
            : approval.approvalId
              ? await waitForApproval(ctx.task.id, approval.approvalId)
              : "cancelled";
          if (decision !== "approved") {
            if (approval.approvalId && decision !== "denied") {
              await repo.setApprovalStatus(approval.approvalId, "denied");
              emitEvent({
                type: "approval",
                taskId: ctx.task.id,
                payload: { approvalId: approval.approvalId, status: "denied" },
              });
            }
            const result =
              decision === "denied"
                ? "The operator denied this validation; no request was sent."
                : decision === "timed_out"
                  ? "Approval was not received within five minutes; no request was sent."
                  : "The task stopped before approval; no request was sent.";
            await repo.recordFindingValidation({
              findingId: finding.id,
              type,
              parameter,
              payload,
              status: decision === "denied" ? "denied" : "inconclusive",
              result,
            });
            emitEvent({
              type: "finding",
              taskId: ctx.task.id,
              payload: { findingId: finding.id, validationStatus: decision },
            });
            return { finding_id: finding.id, status: decision, result };
          }
        }

        let verdict: "confirmed" | "potential" | "not_confirmed" | "inconclusive" | "blocked";
        let result: string;
        let status: number | null = null;
        try {
          const response = await sendValidationProbe(target, type, payload, parameter);
          status = response.status;
          const assessment = assessValidationResponse(type, payload, response);
          verdict = assessment.verdict;
          result = `${assessment.result}${response.truncated ? " Response body was truncated." : ""}`;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          verdict = /private or reserved|Metadata and link-local|Non-standard ports require/i.test(message)
            ? "blocked"
            : "inconclusive";
          result = `No vulnerability verdict: ${message}`;
        }
        const validatedDescription = createdCandidate
          ? verdict === "confirmed"
            ? "SQL injection confirmed: the single-quote probe triggered a recognized database syntax-error signature."
            : verdict === "potential"
              ? "Potential reflected XSS: the inert script canary was reflected in HTML; script execution was not tested."
              : `Potential issue not confirmed by the safe ${type === "sql_error" ? "SQL syntax-error" : "reflected-XSS"} probe.`
          : undefined;
        await repo.recordFindingValidation({
          findingId: finding.id,
          type,
          parameter,
          payload,
          status: verdict,
          result,
          description: validatedDescription,
        });
        if (verdict === "confirmed" && finding.node_id && ctx.intentId) {
          const edges = await repo.listEdges(ctx.task.id);
          const alreadyProven = edges.some(
            (edge) =>
              edge.from_id === ctx.intentId &&
              edge.to_id === finding.node_id &&
              edge.relation === "proves",
          );
          if (!alreadyProven) await repo.addEdge(ctx.task.id, ctx.intentId, finding.node_id, "proves");
        }
        await repo.addTraffic({
          taskId: ctx.task.id,
          intentId: ctx.intentId ?? null,
          method: "GET",
          url: approvalUrl.toString(),
          status,
          request: `GET ${target.origin}${target.pathname} with query parameter ${parameter}=${payload}; other query values redacted.`,
          response: result,
        });
        await logActivity(ctx, {
          type: "validation",
          title: `validator ${verdict}: finding #${finding.id}`,
          content: result,
          data: { finding_id: finding.id, type, parameter, payload, status },
        });
        emitEvent({ type: "finding", taskId: ctx.task.id, payload: { findingId: finding.id, validationStatus: verdict } });
        return { finding_id: finding.id, type, parameter, payload, status: verdict, result };
      },
    }),
    submit_asset: tool({
      description:
        "Submit a raw observation of a new asset into the global asset graph. Parent-child relationships and dedup keys are computed by the program.",
      inputSchema: z.object({
        kind: z.enum(ASSET_KINDS),
        value: z.string(),
        parent_id: z.number().optional().describe("Parent asset id, when the relationship is known."),
        attributes: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async ({ kind, value, parent_id, attributes }) => {
        const parent = parent_id ? await repo.getAsset(parent_id) : undefined;
        const companyId = parent?.company_id ?? (await repo.listScopeAssets(ctx.task.id))[0]?.company_id ?? null;
        const { asset, created } = await repo.upsertAsset({ companyId, kind, value, parentId: parent_id ?? null, attributes });
        if (parent_id && parent) {
          const scope = await repo.listScopeAssets(ctx.task.id);
          const parentIsInScope = scope.some((scopedAsset) => scopedAsset.id === parent_id);
          const parentHost = extractHost(parent.value).toLowerCase();
          const discoveredHost = extractHost(value).toLowerCase();
          const sameHost = parentHost === discoveredHost;
          const inParentDomain = kind === "subdomain" &&
            (sameHost || discoveredHost.endsWith(`.${parentHost}`));
          const scopedEndpoint = kind === "endpoint" && sameHost;
          const scopedService = kind === "service" && sameHost;
          if (parentIsInScope && (scopedEndpoint || (created && (inParentDomain || scopedService)))) {
            await repo.addTaskScope(ctx.task.id, [asset.id]);
          }
        }
        await logActivity(ctx, {
          type: "asset",
          title: `${created ? "new" : "known"} asset ${kind} ${value}`,
          data: { asset_id: asset.id, created },
        });
        emitEvent({ type: "asset", taskId: ctx.task.id, payload: { assetId: asset.id, kind, value, created } });
        return { asset_id: asset.id, created, kind, value };
      },
    }),
    submit_fact: tool({
      description: "Write a verified observation into the task's exploration graph as a fact node, anchored to the assets it concerns.",
      inputSchema: z.object({
        title: z.string(),
        content: z.string(),
        anchor_asset_ids: z.array(z.number()).optional(),
      }),
      execute: async ({ title, content, anchor_asset_ids }) => {
        const scopeIds = new Set((await repo.listScopeAssets(ctx.task.id)).map((asset) => asset.id));
        const intentAssetIds = ctx.intentId ? await repo.listAnchoredAssetIds(ctx.intentId) : [];
        const anchorIds = anchor_asset_ids?.length
          ? anchor_asset_ids
          : intentAssetIds;
        if (
          anchorIds.length === 0 ||
          anchorIds.some((id) => !scopeIds.has(id) || (ctx.intentId !== undefined && !intentAssetIds.includes(id)))
        ) {
          return { error: "Facts must be anchored to assets explicitly in scope and, for workers, to this intent." };
        }
        const node = await repo.createNode({
          taskId: ctx.task.id,
          kind: "fact",
          title,
          content,
          status: "done",
          data: { source_intent: ctx.intentId ?? null },
        });
        await repo.addAnchor(node.id, anchorIds);
        if (ctx.intentId) await repo.addEdge(ctx.task.id, ctx.intentId, node.id, "yields");
        await logActivity(ctx, { type: "fact", title: `fact: ${title}`, content });
        emitEvent({ type: "fact", taskId: ctx.task.id, payload: { nodeId: node.id, title } });
        return { fact_id: node.id };
      },
    }),
    submit_finding: tool({
      description:
        "Record a potential vulnerability as an unverified finding with its supporting observation. Every field is mandatory: describe the suspected vulnerability, give safe reproduction steps, identify the exact affected location, explain potential attacker impact, and cite concrete evidence. If a safe in-scope test already produced a payload and response/result, optionally include them as observed_payload and observed_result; these are reported evidence, not proof of validator confirmation. After submitting, call validate_finding before treating the issue as confirmed. Never submit simulated signals as evidence.",
      inputSchema: z.object({
        title: z.string().trim().min(1),
        severity: z.enum(SEVERITIES),
        description: z.string().trim().min(1).describe("Nature of the vulnerability."),
        reproduction: z.string().trim().min(1).describe("Safe, concrete steps to trigger the vulnerability."),
        location: z.string().trim().min(1).describe("Exact affected asset, URL/path, parameter, component, or code location."),
        impact: z.string().trim().min(1).describe("What an attacker can achieve if the vulnerability is exploited."),
        evidence: z.string().trim().min(1).describe("Required proof: concrete, sanitized tool observations that directly demonstrate this vulnerability; do not submit an unsupported hypothesis."),
        observed_payload: z.string().trim().max(4096).optional().describe("Payload actually used during the reported observation. Stored for evidence only; it is not executed by this tool."),
        observed_result: z.string().trim().max(8192).optional().describe("Sanitized response or result actually observed when using the payload. Stored for evidence only."),
        asset_id: z.number().optional(),
      }),
      execute: async ({ title, severity, description, reproduction, location, impact, evidence, observed_payload, observed_result, asset_id }) => {
        const scopeIds = new Set((await repo.listScopeAssets(ctx.task.id)).map((asset) => asset.id));
        const intentAssetIds = ctx.intentId ? await repo.listAnchoredAssetIds(ctx.intentId) : [];
        const assetIds = asset_id !== undefined ? [asset_id] : intentAssetIds;
        if (
          assetIds.length === 0 ||
          assetIds.some((id) => !scopeIds.has(id) || (ctx.intentId !== undefined && !intentAssetIds.includes(id)))
        ) {
          return { error: "Findings must reference assets explicitly in scope and, for workers, anchored to this intent." };
        }
        const node = await repo.createNode({
          taskId: ctx.task.id,
          kind: "finding",
          title,
          content: description,
          status: "done",
          data: { severity, source_intent: ctx.intentId ?? null },
        });
        await repo.addAnchor(node.id, assetIds);
        if (ctx.intentId) await repo.addEdge(ctx.task.id, ctx.intentId, node.id, "yields");
        const finding = await repo.createFinding({
          taskId: ctx.task.id,
          assetId: assetIds[0] ?? null,
          nodeId: node.id,
          title,
          severity,
          description,
          reproduction,
          location,
          impact,
          evidence,
          observedPayload: observed_payload,
          observedResult: observed_result,
        });
        await logActivity(ctx, { type: "finding", title: `finding(${severity}): ${title}`, content: description });
        emitEvent({ type: "finding", taskId: ctx.task.id, payload: { findingId: finding.id, title, severity } });
        return { finding_id: finding.id, node_id: node.id };
      },
    }),
    finish_intent: tool({
      description: "Mark the claimed intent complete once this worker's work is written back to both graphs.",
      inputSchema: z.object({ summary: z.string() }),
      execute: async ({ summary }) => {
        if (ctx.intentId) await repo.updateNodeStatus(ctx.intentId, "done");
        await logActivity(ctx, { type: "intent_done", title: `intent #${ctx.intentId} complete`, content: summary });
        emitEvent({ type: "intent_done", taskId: ctx.task.id, payload: { intentId: ctx.intentId, summary } });
        return { status: "done" };
      },
    }),
  };
}

export function buildDeadlineValidationTools(ctx: RunContext) {
  const workerTools = buildWorkerTools(ctx);
  return { validate_finding: workerTools.validate_finding };
}
