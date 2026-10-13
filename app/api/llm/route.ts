import { unauthorized, badRequest } from "@/lib/api";
import * as repo from "@/lib/repo";
import { defaultBaseUrl, providerEnvKey, providerRequiresApiKey } from "@/lib/llm";
import { PROVIDERS, type ProviderId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await unauthorized();
  if (denied) return denied;
  const configs = (await repo.listLlmConfigs()).map((c) => ({
    id: c.id,
    name: c.name,
    provider: c.provider,
    model: c.model,
    base_url: c.base_url,
    has_key: Boolean(c.api_key),
    temperature: c.temperature,
    is_active: c.is_active,
  }));
  return Response.json({
    configs,
    env: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY),
      orcarouter: Boolean(process.env.ORCAROUTER_API_KEY),
      mistral: Boolean(process.env.MISTRAL_API_KEY),
      ollama: Boolean(process.env.OLLAMA_API_KEY),
    },
  });
}

export async function POST(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    provider?: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
    temperature?: number;
    activate?: boolean;
  };
  if (!body.provider || !PROVIDERS.includes(body.provider as ProviderId)) {
    return badRequest(`provider must be one of: ${PROVIDERS.join(", ")}`);
  }
  if (!body.model?.trim()) return badRequest("model is required");
  const provider = body.provider as ProviderId;
  if (provider === "mock") {
    return badRequest("The offline simulator is disabled for agent tasks. Configure a live model provider.");
  }
  const envKey = providerEnvKey(provider);
  if (providerRequiresApiKey(provider, body.baseUrl || defaultBaseUrl(provider)) && !body.apiKey?.trim()) {
    if (!envKey || !process.env[envKey]) {
      return badRequest(
        `an API key is required for ${provider} (paste one here, or set ${envKey ?? "the provider env key"})`,
      );
    }
  }
  const config = await repo.createLlmConfig({
    name: body.name?.trim() || `${body.provider} ${body.model}`,
    provider: body.provider as ProviderId,
    model: body.model.trim(),
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
    temperature: body.temperature,
    activate: body.activate !== false,
  });
  return Response.json({ config: { ...config, api_key: config.api_key ? "set" : null } }, { status: 201 });
}
