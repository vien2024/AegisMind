import { ToolLoopAgent, stepCountIs, tool } from "ai";
import { z } from "zod";
import {
  createCommandExecutionTool,
  createPythonTools,
  coverageSnapshot,
  graphOverview,
  type RunContext,
} from "./agent-tools";
import { resolveModel } from "./llm";
import * as repo from "./repo";

const INSTRUCTIONS = `You are the MAIN AGENT (human-in-the-loop) of AegisMind.

Answer questions about this specific task using the read tools. You can also send new intents with
send_intent when the operator asks for a new direction, and re-open the goal with prove_goal once
everything is covered.

Be concise. Cite the intent/finding ids you used. Never invent observations or present simulated
output as evidence. You can run shell commands and create/run Python files for workspace work without
per-run approval. Those executions have time/output limits but are not sandboxed. Use them for
reconnaissance only within the task's explicitly authorized scope, and do not bypass validator safety limits.`;

export async function buildMainAgent(taskId: number) {
  const task = await repo.getTask(taskId);
  if (!task) throw new Error(`task ${taskId} not found`);
  const ctx: RunContext = { task, role: "mainagent" };

  const tools = {
    execute_cmd: createCommandExecutionTool(ctx),
    ...createPythonTools(ctx),
    get_graph_overview: tool({
      description: "Read node counts, open intents, recent facts and findings for this task.",
      inputSchema: z.object({}),
      execute: async () => graphOverview(taskId),
    }),
    get_coverage: tool({
      description: "List in-scope assets and whether each has been tested.",
      inputSchema: z.object({}),
      execute: async () => coverageSnapshot(taskId),
    }),
    list_findings: tool({
      description: "List the findings recorded for this task.",
      inputSchema: z.object({}),
      execute: async () =>
        (await repo.listFindings(taskId)).map((f) => ({
          id: f.id,
          title: f.title,
          severity: f.severity,
          status: f.status,
          description: f.description,
          observed_payload: f.observed_payload,
          observed_result: f.observed_result,
        })),
    }),
    list_recent_activity: tool({
      description: "List the most recent activity records (worker traces) for this task.",
      inputSchema: z.object({ limit: z.number().optional() }),
      execute: async ({ limit }) =>
        (await repo.listActivity(taskId, Math.min(limit ?? 40, 200))).map((a) => ({
          id: a.id,
          role: a.role,
          type: a.type,
          title: a.title,
        })),
    }),
    send_intent: tool({
      description: "Send a new intent to the frontier on behalf of the operator.",
      inputSchema: z.object({
        title: z.string(),
        description: z.string(),
        asset_ids: z.array(z.number()).min(1),
      }),
      execute: async ({ title, description, asset_ids }) => {
        const node = await repo.createNode({
          taskId,
          kind: "intent",
          title,
          content: description,
          status: "pending",
          data: { source: "mainagent" },
        });
        await repo.addAnchor(node.id, asset_ids);
        return { intent_id: node.id };
      },
    }),
  };

  const resolved = await resolveModel();

  return new ToolLoopAgent({
    id: "mainagent",
    model: resolved.model,
    instructions: `${INSTRUCTIONS}\n\nCurrent task: ${task.name} (target ${task.target}).`,
    tools,
    stopWhen: stepCountIs(6),
  });
}
