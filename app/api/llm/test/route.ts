import { generateText, stepCountIs } from "ai";
import { unauthorized, badRequest } from "@/lib/api";
import { buildModelFromParams } from "@/lib/llm";
import type { ProviderId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as {
    provider?: ProviderId;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  };
  if (!body.provider || !body.model) return badRequest("provider and model are required");
  if (body.provider === "mock") {
    return badRequest("Offline simulator profiles are not supported for agent tasks.");
  }

  const resolved = buildModelFromParams({
    provider: body.provider,
    model: body.model.trim(),
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
  });

  const started = Date.now();
  try {
    const result = await generateText({
      model: resolved.model,
      prompt: "Reply with the single word: ok",
      stopWhen: stepCountIs(1),
      abortSignal: AbortSignal.timeout(20000),
    });
    return Response.json({
      ok: true,
      latencyMs: Date.now() - started,
      provider: resolved.provider,
      model: resolved.modelId,
      live: resolved.live,
      reply: (result.text || "(empty)").slice(0, 120),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        latencyMs: Date.now() - started,
        provider: resolved.provider,
        model: resolved.modelId,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 200 },
    );
  }
}
