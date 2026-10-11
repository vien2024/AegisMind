import { ToolLoopAgent, stepCountIs, tool } from "ai";
import { z } from "zod";
import { coverageSnapshot, graphOverview } from "./agent-tools";
import { resolveModel } from "./llm";
import * as repo from "./repo";

const INSTRUCTIONS = `You are the MAIN AGENT (human-in-the-loop) of AegisMind.

Answer questions about this specific task using the read tools. You can also send new intents with
send_intent when the operator asks for a new direction, and re-open the goal with prove_goal once
everything is covered.

Be concise. Cite the intent/finding ids you used. This edition explores a local, offline simulation;
never claim to have contacted a real system, and never instruct the operator to attack one.`;

export async function buildMainAgent(taskId: number) {
  const task = await repo.getTask(taskId);
  if (!task) throw new Error(`task ${taskId} not found`);

  const tools = {
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

  const resolved = await resolveModel({
    modelId: "aegismind-chat-sim",
    script: () => ({
      type: "text",
      text:
        "This task is running in offline simulator mode, so I can only answer from the local graphs. " +
        "Open Settings → LLM configuration and add an OpenAI or Anthropic key to chat with a live model. " +
        "Meanwhile, the Dashboard, exploration graph and findings views show everything the engine has produced.",
    }),
  });

  return new ToolLoopAgent({
    id: "mainagent",
    model: resolved.model,
    instructions: `${INSTRUCTIONS}\n\nCurrent task: ${task.name} (target ${task.target}).`,
    tools,
    stopWhen: stepCountIs(6),
  });
}
