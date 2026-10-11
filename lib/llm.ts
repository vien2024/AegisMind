import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { createMockModel, type MockStep } from "./mock-model";
import { getActiveLlmConfig } from "./repo";
import type { ProviderId } from "./types";

/** OpenAI-compatible multi-provider gateways. They speak the Chat Completions
 *  wire format, so the AI SDK `createOpenAI` provider drives them; only the
 *  default base URL and the environment key that can substitute for a stored
 *  key differ from plain OpenAI.
 */
export interface GatewaySpec {
  label: string;
  baseURL: string;
  envKey: string;
  /** Model used when falling back to an environment key. Ids are vendor-prefixed. */
  defaultModel: string;
}

export const GATEWAYS: Partial<Record<ProviderId, GatewaySpec>> = {
  openrouter: {
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    defaultModel: "openai/gpt-4o-mini",
  },
  orcarouter: {
    label: "Orca Router",
    baseURL: "https://api.orcarouter.ai/v1",
    envKey: "ORCAROUTER_API_KEY",
    defaultModel: "openai/gpt-4o-mini",
  },
};

export function gatewayFor(provider: ProviderId): GatewaySpec | undefined {
  return GATEWAYS[provider];
}

/** Default base URL for a provider, if it is not the SDK's own endpoint. */
export function defaultBaseUrl(provider: ProviderId): string | undefined {
  return GATEWAYS[provider]?.baseURL;
}

/** Environment variable that can supply a key for this provider. */
export function providerEnvKey(provider: ProviderId): string | undefined {
  if (provider === "openai") return "OPENAI_API_KEY";
  if (provider === "anthropic") return "ANTHROPIC_API_KEY";
  return GATEWAYS[provider]?.envKey;
}

/** True when the provider is driven through the OpenAI Chat Completions format. */
export function isOpenAICompatible(provider: ProviderId): boolean {
  return provider === "openai" || Boolean(GATEWAYS[provider]);
}

export interface ResolvedModel {
  model: LanguageModel;
  provider: ProviderId | "openai-env" | "anthropic-env" | "mock";
  modelId: string;
  live: boolean;
}

export interface MockFallback {
  script: MockStep[] | (() => MockStep | null);
  modelId?: string;
}

/**
 * Resolve the language model for a run.
 *
 * Order: active DB configuration -> environment API key -> offline simulator.
 * The offline simulator is a real `LanguageModelV4` (see lib/mock-model.ts), so
 * the agent code path through the AI SDK is identical in every mode.
 */
export async function resolveModel(mock: MockFallback): Promise<ResolvedModel> {
  const config = await getActiveLlmConfig();

  if (config) {
    if (config.provider === "mock") {
      return {
        model: createMockModel(mock),
        provider: "mock",
        modelId: config.model,
        live: false,
      };
    }
    if (isOpenAICompatible(config.provider)) {
      const gateway = gatewayFor(config.provider);
      const provider = createOpenAI({
        apiKey:
          config.api_key ||
          (gateway ? process.env[gateway.envKey] : process.env.OPENAI_API_KEY),
        baseURL:
          config.base_url || gateway?.baseURL || undefined,
      });
      return {
        model: provider(config.model) as unknown as LanguageModel,
        provider: config.provider,
        modelId: config.model,
        live: true,
      };
    }
    if (config.provider === "anthropic") {
      const provider = createAnthropic({
        apiKey: config.api_key || process.env.ANTHROPIC_API_KEY,
        baseURL: config.base_url || undefined,
      });
      return {
        model: provider(config.model) as unknown as LanguageModel,
        provider: "anthropic",
        modelId: config.model,
        live: true,
      };
    }
  }

  if (process.env.OPENAI_API_KEY) {
    const modelId = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    return {
      model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(modelId) as unknown as LanguageModel,
      provider: "openai-env",
      modelId,
      live: true,
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const modelId = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
    return {
      model: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelId) as unknown as LanguageModel,
      provider: "anthropic-env",
      modelId,
      live: true,
    };
  }

  for (const [providerId, gateway] of Object.entries(GATEWAYS)) {
    const apiKey = gateway && process.env[gateway.envKey];
    if (!apiKey || !gateway) continue;
    const provider = createOpenAI({ apiKey, baseURL: gateway.baseURL });
    return {
      model: provider(gateway.defaultModel) as unknown as LanguageModel,
      provider: providerId as ProviderId,
      modelId: gateway.defaultModel,
      live: true,
    };
  }

  return {
    model: createMockModel(mock),
    provider: "mock",
    modelId: mock.modelId ?? "aegismind-simulator",
    live: false,
  };
}

/** Build a model from explicit, not-yet-saved parameters (used by the connection test). */
export function buildModelFromParams(input: {
  provider: ProviderId;
  model: string;
  baseUrl?: string | null;
  apiKey?: string | null;
}): ResolvedModel {
  if (isOpenAICompatible(input.provider)) {
    const gateway = gatewayFor(input.provider);
    const provider = createOpenAI({
      apiKey:
        input.apiKey ||
        (gateway ? process.env[gateway.envKey] : process.env.OPENAI_API_KEY),
      baseURL: input.baseUrl || gateway?.baseURL || undefined,
    });
    return {
      model: provider(input.model) as unknown as LanguageModel,
      provider: input.provider,
      modelId: input.model,
      live: true,
    };
  }
  if (input.provider === "anthropic") {
    const provider = createAnthropic({
      apiKey: input.apiKey || process.env.ANTHROPIC_API_KEY,
      baseURL: input.baseUrl || undefined,
    });
    return {
      model: provider(input.model) as unknown as LanguageModel,
      provider: "anthropic",
      modelId: input.model,
      live: true,
    };
  }
  return {
    model: createMockModel({ modelId: input.model, script: [{ type: "text", text: "ok" }] }),
    provider: "mock",
    modelId: input.model,
    live: false,
  };
}
