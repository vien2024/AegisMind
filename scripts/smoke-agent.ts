import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { createMockModel } from "../lib/mock-model";

async function main() {
  const calls: unknown[] = [];
  const model = createMockModel({
    script: [
      { type: "tool", toolName: "lookup", input: { q: "example.com" } },
      { type: "text", text: "done" },
    ],
  });

  const result = await generateText({
    model,
    instructions: "test",
    prompt: "go",
    stopWhen: stepCountIs(4),
    tools: {
      lookup: tool({
        description: "look something up",
        inputSchema: z.object({ q: z.string() }),
        execute: async ({ q }) => {
          calls.push(q);
          return { found: true, q };
        },
      }),
    },
  });

  console.log("steps:", result.steps.length);
  console.log("tool calls:", JSON.stringify(result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName))));
  console.log("tool executions:", JSON.stringify(calls));
  console.log("text:", result.text);
  if (calls.length !== 1) throw new Error("expected exactly one tool execution");
  if (result.steps.length < 2) throw new Error("expected the tool loop to run more than one step");
  console.log("SMOKE OK");
}

main().catch((err) => {
  console.error("SMOKE FAILED:", err);
  process.exit(1);
});
