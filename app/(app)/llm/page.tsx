import { LlmClient } from "@/components/llm-client";
import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function LlmPage() {
  await requirePageUser();
  const configs = (await repo.listLlmConfigs()).map((config) => ({
    id: config.id,
    name: config.name,
    provider: config.provider,
    model: config.model,
    base_url: config.base_url,
    has_key: Boolean(config.api_key),
    temperature: config.temperature,
    is_active: config.is_active,
  }));
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const totals = await repo.usageTotals();

  return (
    <LlmClient
      configs={configs}
      env={{
        openai: Boolean(process.env.OPENAI_API_KEY),
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        openrouter: Boolean(process.env.OPENROUTER_API_KEY),
        orcarouter: Boolean(process.env.ORCAROUTER_API_KEY),
        mistral: Boolean(process.env.MISTRAL_API_KEY),
        ollama: Boolean(process.env.OLLAMA_API_KEY),
      }}
      usageInitial={{
        range: "month",
        model: null,
        totals: {
          ...totals,
          cacheHitRate: totals.total > 0 ? Math.round((totals.cacheRead / totals.total) * 100) : 0,
        },
        byModel: await repo.usageByModel(),
        series: await repo.usageSeries(since, "month"),
      }}
    />
  );
}
