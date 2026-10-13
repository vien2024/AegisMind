import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
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
  envBaseURL?: string;
  envDefaultModel?: string;
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
  mistral: {
    label: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY",
    defaultModel: "mistral-small-latest",
  },
  ollama: {
    label: "Ollama",
    baseURL: "http://localhost:11434/v1",
    envKey: "OLLAMA_API_KEY",
    defaultModel: "llama3.2",
    envBaseURL: "https://ollama.com/v1",
    envDefaultModel: "gpt-oss:20b-cloud",
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

function isLocalEndpoint(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

export function providerRequiresApiKey(provider: ProviderId, baseUrl: string | undefined): boolean {
  if (provider === "mock") return false;
  if ((provider === "mistral" || provider === "ollama") && isLocalEndpoint(baseUrl)) return false;
  return Boolean(providerEnvKey(provider));
}

function apiKeyFor(provider: ProviderId, apiKey: string | null | undefined, baseUrl: string | undefined) {
  const gateway = gatewayFor(provider);
  return (
    apiKey ||
    (gateway ? process.env[gateway.envKey] : process.env.OPENAI_API_KEY) ||
    (isLocalEndpoint(baseUrl) && (provider === "mistral" || provider === "ollama")
      ? "local"
      : undefined)
  );
}

export interface ResolvedModel {
  model: LanguageModel;
  provider: ProviderId | "openai-env" | "anthropic-env";
  modelId: string;
  live: boolean;
}

/**
 * Resolve the language model for a run.
 *
 * Task agents must use a configured live provider. There is deliberately no
 * simulator fallback: a missing or mock provider is a configuration error.
 */
export async function resolveModel(): Promise<ResolvedModel> {
  const config = await getActiveLlmConfig();

  if (config) {
    if (config.provider === "mock") {
      throw new Error("The active model profile is the offline simulator. Select a live model in Settings → LLM before running agents.");
    }
    if (isOpenAICompatible(config.provider)) {
      const gateway = gatewayFor(config.provider);
      const baseURL = config.base_url || gateway?.baseURL;
      const apiKey = apiKeyFor(config.provider, config.api_key, baseURL);
      if (providerRequiresApiKey(config.provider, baseURL) && !apiKey) {
        throw new Error(`The active ${config.provider} model profile has no API key. Configure a key or activate a local provider.`);
      }
      const provider = createOpenAI({
        apiKey,
        baseURL: baseURL || undefined,
      });
      return {
        model: provider.chat(config.model) as unknown as LanguageModel,
        provider: config.provider,
        modelId: config.model,
        live: true,
      };
    }
    if (config.provider === "anthropic") {
      const apiKey = config.api_key || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error("The active Anthropic model profile has no API key. Configure a key in Settings → LLM.");
      }
      const provider = createAnthropic({
        apiKey,
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
    const provider = createOpenAI({ apiKey, baseURL: gateway.envBaseURL ?? gateway.baseURL });
    return {
      model: provider.chat(gateway.envDefaultModel ?? gateway.defaultModel) as unknown as LanguageModel,
      provider: providerId as ProviderId,
      modelId: gateway.envDefaultModel ?? gateway.defaultModel,
      live: true,
    };
  }

  throw new Error(
    "No live LLM provider is configured. Activate a provider in Settings → LLM, set a provider API key, or configure a local Mistral/Ollama endpoint.",
  );
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
    const baseURL = input.baseUrl || gateway?.baseURL;
    const provider = createOpenAI({
      apiKey: apiKeyFor(input.provider, input.apiKey, baseURL),
      baseURL: baseURL || undefined,
    });
    return {
      model: provider.chat(input.model) as unknown as LanguageModel,
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
  throw new Error("The offline simulator cannot be used by task agents.");
}
