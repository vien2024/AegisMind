import { tool } from "ai";
import { z } from "zod";
import { emitEvent } from "./events";
import * as repo from "./repo";
import { RECON_TECHNIQUES, simulateRecon, type Technique } from "./simulate";
import { ASSET_KINDS, NODE_KINDS, SEVERITIES, type Asset, type Task } from "./types";

export interface RunContext {
  task: Task;
  role: "planner" | "worker";
  intentId?: number;
  workerIndex?: number;
}

async function logActivity(
  ctx: RunContext,
  input: { type: string; title: string; content?: string; data?: Record<string, unknown>; step?: number },
): Promise<void> {
  await repo.addActivity({
    taskId: ctx.task.id,
    intentId: ctx.intentId ?? null,
    step: input.step ?? null,
    role: ctx.role === "planner" ? "planner" : `worker#${ctx.workerIndex ?? 1}`,
    type: input.type,
    title: input.title,
    content: input.content,
    data: input.data,
  });
  emitEvent({ type: "activity", taskId: ctx.task.id, payload: { title: input.title, role: ctx.role } });
}

/** Approval gate: every tool that would "touch" an asset passes through this. */
async function guard(ctx: RunContext, toolName: string, args: Record<string, unknown>) {
  // Honour a decision that was already made for this intent + tool so an
  // approved call is not re-queued on every wake.
  const decided = await repo.findDecidedApproval(ctx.task.id, ctx.intentId ?? null, toolName);
  if (decided) {
    if (decided.status === "denied") return { approved: false as const, denialId: decided.id };
    return { approved: true as const };
  }

  const autoApprove = ctx.task.auto_approve === 1;
  if (autoApprove) {
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
    reason: "task requires manual interception approval",
    status: "pending",
  });
  if (ctx.intentId) await repo.updateNodeStatus(ctx.intentId, "awaiting_approval");
  emitEvent({ type: "approval", taskId: ctx.task.id, payload: { approvalId: approval.id, tool: toolName } });
  return { approved: false as const, approvalId: approval.id };
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
  const findings = nodes.filter((n) => n.kind === "finding").map((n) => ({ id: n.id, title: n.title }));
  const goal = nodes.find((n) => n.kind === "goal");
  return { counts, openIntents, recentFacts: facts, findings, goal: goal ? { id: goal.id, status: goal.status, title: goal.title } : null };
}

/* ------------------------------------------------------------------ */
/* Planner tools                                                       */
/* ------------------------------------------------------------------ */

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
    search_assets: tool({
      description: "Search the global asset graph by value (domain, ip, endpoint) or kind.",
      inputSchema: z.object({
        query: z.string().optional(),
        kind: z.enum(ASSET_KINDS).optional(),
      }),
      execute: async ({ query, kind }) => {
        const assets = await repo.listAssets({ search: query, kind });
        return assets.slice(0, 50).map((a) => ({ id: a.id, kind: a.kind, value: a.value }));
      },
    }),
    send_intent: tool({
      description:
        "Send a single new intent into the frontier. Only send an intent when there is an uncovered direction; most wakes should send none. Each intent is claimed by exactly one worker.",
      inputSchema: z.object({
        title: z.string().describe("Short imperative title, e.g. 'Enumerate subdomains of example.com'"),
        description: z.string().describe("What the worker should determine and why it advances the goal."),
        asset_ids: z.array(z.number()).min(1).describe("Assets this direction probes; these anchor the intent."),
      }),
      execute: async ({ title, description, asset_ids }) => {
        const nodes = await repo.listNodes(ctx.task.id, "intent", 1000);
        let existing = null;
        for (const node of nodes) {
          const anchored = await repo.listAnchoredAssetIds(node.id);
          if (anchored.some((assetId) => asset_ids.includes(assetId))) {
            existing = node;
            break;
          }
        };
        if (existing) {
          return {
            created: false,
            intent_id: existing.id,
            reason: "an intent already probes one of these assets; wait for it instead of duplicating",
          };
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
          title: `planner sent intent #${node.id}: ${title}`,
          content: description,
          data: { asset_ids },
        });
        emitEvent({ type: "intent", taskId: ctx.task.id, payload: { intentId: node.id, title } });
        return { created: true, intent_id: node.id };
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
    run_recon: tool({
      description:
        "Run a reconnaissance technique against one in-scope asset (LOCAL SIMULATION in this edition — no network traffic is generated). Returns observations and discovered assets.",
      inputSchema: z.object({
        asset_id: z.number(),
        technique: z.enum(RECON_TECHNIQUES),
      }),
      execute: async ({ asset_id, technique }) => {
        const guardResult = await guard(ctx, "run_recon", { asset_id, technique });
        if (!guardResult.approved) {
          return {
            pending_approval: true,
            approval_id: guardResult.approvalId ?? guardResult.denialId,
            message: guardResult.denialId
              ? "This tool call was denied by the operator; record what you can and finish the intent."
              : "Execution is blocked pending manual approval.",
          };
        }
        const asset = await repo.getAsset(asset_id);
        if (!asset) return { error: `asset ${asset_id} not found` };
        const result = simulateRecon({ taskId: ctx.task.id, intentId: ctx.intentId!, asset, technique: technique as Technique });
        await logActivity(ctx, {
          type: "tool_result",
          title: `run_recon(${technique}) on ${asset.value}`,
          content: result.observations.join("\n"),
          data: { technique, asset_id, observations: result.observations },
        });
        await repo.addTraffic({
          taskId: ctx.task.id,
          intentId: ctx.intentId ?? null,
          method: result.traffic.method,
          url: result.traffic.url,
          status: result.traffic.status,
          request: result.traffic.request,
          response: result.traffic.response,
        });
        emitEvent({ type: "traffic", taskId: ctx.task.id, payload: { url: result.traffic.url } });
        return {
          technique,
          asset: asset.value,
          observations: result.observations,
          discovered: result.assets,
          signal: result.finding ?? null,
        };
      },
    }),
    dns_lookup: tool({
      description: "Resolve a hostname to addresses (LOCAL SIMULATION — offline).",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        const guardResult = await guard(ctx, "dns_lookup", { name });
        if (!guardResult.approved) {
          return { pending_approval: true, approval_id: guardResult.approvalId ?? guardResult.denialId };
        }
        const companyId = (await repo.listScopeAssets(ctx.task.id))[0]?.company_id ?? null;
        const { asset } = await repo.upsertAsset({ companyId, kind: "subdomain", value: name });
        const result = simulateRecon({ taskId: ctx.task.id, intentId: ctx.intentId!, asset, technique: "dns" });
        await logActivity(ctx, { type: "tool_result", title: `dns_lookup(${name})`, content: result.observations.join("\n") });
        await repo.addTraffic({
          taskId: ctx.task.id,
          intentId: ctx.intentId ?? null,
          method: "DNS",
          url: `dns://${name}`,
          status: 0,
          request: `# simulated dns lookup\nname: ${name}`,
          response: result.observations.join("\n"),
        });
        return { name, observations: result.observations, discovered: result.assets };
      },
    }),
    http_probe: tool({
      description: "Send an HTTP request to an in-scope endpoint (LOCAL SIMULATION — offline).",
      inputSchema: z.object({ url: z.string(), method: z.string().optional() }),
      execute: async ({ url, method }) => {
        const guardResult = await guard(ctx, "http_probe", { url, method });
        if (!guardResult.approved) {
          return { pending_approval: true, approval_id: guardResult.approvalId ?? guardResult.denialId };
        }
        const { asset } = await repo.upsertAsset({ companyId: null, kind: "endpoint", value: url });
        const result = simulateRecon({ taskId: ctx.task.id, intentId: ctx.intentId!, asset, technique: "http" });
        await logActivity(ctx, { type: "tool_result", title: `http_probe ${method ?? "GET"} ${url}`, content: result.observations.join("\n") });
        await repo.addTraffic({
          taskId: ctx.task.id,
          intentId: ctx.intentId ?? null,
          method: method ?? "GET",
          url,
          status: result.traffic.status,
          request: result.traffic.request,
          response: result.traffic.response,
        });
        return { url, status: result.traffic.status, observations: result.observations, signal: result.finding ?? null };
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
        if (created && kind !== "endpoint") await repo.addTaskScope(ctx.task.id, [asset.id]);
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
        const node = await repo.createNode({
          taskId: ctx.task.id,
          kind: "fact",
          title,
          content,
          status: "done",
          data: { source_intent: ctx.intentId },
        });
        const anchorIds = anchor_asset_ids?.length
          ? anchor_asset_ids
          : (await intentAssets(ctx.intentId!)).map((a) => a.id);
        await repo.addAnchor(node.id, anchorIds);
        if (ctx.intentId) await repo.addEdge(ctx.task.id, ctx.intentId, node.id, "yields");
        await logActivity(ctx, { type: "fact", title: `fact: ${title}`, content });
        emitEvent({ type: "fact", taskId: ctx.task.id, payload: { nodeId: node.id, title } });
        return { fact_id: node.id };
      },
    }),
    submit_finding: tool({
      description: "Record a vulnerability as both an exploration-graph finding node and a finding row.",
      inputSchema: z.object({
        title: z.string(),
        severity: z.enum(SEVERITIES),
        description: z.string(),
        evidence: z.string().optional(),
        asset_id: z.number().optional(),
      }),
      execute: async ({ title, severity, description, evidence, asset_id }) => {
        const node = await repo.createNode({
          taskId: ctx.task.id,
          kind: "finding",
          title,
          content: description,
          status: "done",
          data: { severity },
        });
        const assetIds = asset_id ? [asset_id] : (await intentAssets(ctx.intentId!)).map((a) => a.id);
        await repo.addAnchor(node.id, assetIds);
        if (ctx.intentId) await repo.addEdge(ctx.task.id, ctx.intentId, node.id, "proves");
        const finding = await repo.createFinding({
          taskId: ctx.task.id,
          assetId: assetIds[0] ?? null,
          nodeId: node.id,
          title,
          severity,
          description,
          evidence,
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
