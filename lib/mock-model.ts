import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  LanguageModelV4StreamPart,
  LanguageModelV4ToolCall,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";

/**
 * A deterministic, dependency-free `LanguageModelV4` implementation.
 *
 * The offline ("demo") engine uses this so the full Vercel AI SDK pipeline
 * (ToolLoopAgent -> generateText -> tool execution loop -> stopWhen) still
 * runs with no network access and no API key. It is *not* an LLM: it replays a
 * scripted sequence of tool calls that the engine derives from the current
 * graph state, and it is always labelled as `mock` in the UI.
 */

export type MockStep =
  | { type: "tool"; toolName: string; input: unknown }
  | { type: "text"; text: string };

let callCounter = 0;

/** Rough, clearly-approximate token accounting so the local usage dashboard has real numbers. */
function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

function usageFor(promptText: string, completionText: string): LanguageModelV4Usage {
  const input = estimateTokens(promptText);
  const output = estimateTokens(completionText);
  return {
    inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: output, text: output, reasoning: 0 },
  };
}

export function createMockModel(options: {
  modelId?: string;
  script: MockStep[] | (() => MockStep | null);
}): LanguageModelV4 {
  let step = 0;

  const nextStep = (): MockStep | null => {
    if (typeof options.script === "function") return options.script();
    const entry = options.script[step];
    step += 1;
    return entry ?? null;
  };

  return {
    specificationVersion: "v4",
    provider: "aegismind-mock",
    modelId: options.modelId ?? "aegismind-simulator",
    supportedUrls: {},
    async doGenerate(call: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
      const available = new Set(
        (call.tools ?? [])
          .filter((t): t is Extract<typeof t, { type: "function" }> => t.type === "function")
          .map((t) => t.name),
      );

      // Walk the script but never emit a tool that was not offered.
      let picked: MockStep | null = null;
      while (true) {
        const candidate = nextStep();
        if (!candidate) {
          picked = null;
          break;
        }
        if (candidate.type === "text") {
          picked = candidate;
          break;
        }
        if (available.has(candidate.toolName)) {
          picked = candidate;
          break;
        }
      }

      const content: LanguageModelV4GenerateResult["content"] = [];
      let structuredText = "Offline demo run complete.";

      if (picked && picked.type === "tool") {
        callCounter += 1;
        const toolCall: LanguageModelV4ToolCall = {
          type: "tool-call",
          toolCallId: `mock-call-${callCounter}`,
          toolName: picked.toolName,
          input: JSON.stringify(picked.input ?? {}),
        };
        content.push(toolCall);
        structuredText = `Calling ${picked.toolName}`;
      } else {
        const text = picked && picked.type === "text" ? picked.text : "Offline demo run complete.";
        content.push({ type: "text", text });
        structuredText = text;
      }

      const hasToolCall = content.some((part) => part.type === "tool-call");
      return {
        content,
        finishReason: {
          unified: hasToolCall ? "tool-calls" : "stop",
          raw: hasToolCall ? "tool_calls" : "stop",
        },
        usage: usageFor(JSON.stringify(call.prompt ?? []), structuredText),
        warnings: [],
      };
    },

    async doStream(call: LanguageModelV4CallOptions) {
      const generated = await this.doGenerate(call);
      const parts: LanguageModelV4StreamPart[] = [
        { type: "stream-start", warnings: [] },
      ];
      const textParts = generated.content.filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      );
      const text = textParts.map((part) => part.text).join("");
      if (text) {
        parts.push({ type: "text-start", id: "t0" });
        // Emit in small deltas so the UI still animates.
        const chunks = text.match(/[\s\S]{1,24}/g) ?? [];
        for (const chunk of chunks) parts.push({ type: "text-delta", id: "t0", delta: chunk });
        parts.push({ type: "text-end", id: "t0" });
      }
      parts.push({
        type: "finish",
        usage: generated.usage,
        finishReason: generated.finishReason,
      });

      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  };
}
