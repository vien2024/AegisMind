import { unauthorized } from "@/lib/api";
import * as repo from "@/lib/repo";
import { LANGUAGES, type Language } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await unauthorized();
  if (denied) return denied;
  const settings = await repo.getSystemSettings();
  return Response.json({
    settings,
    env: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      database: repo.resolveDbPath().replace(process.cwd(), "."),
    },
    activeLlm: (await (async () => {
      const active = await repo.getActiveLlmConfig();
      return active
        ? {
            id: active.id,
            name: active.name,
            provider: active.provider,
            model: active.model,
          }
        : null;
    })()),
  });
}

export async function PATCH(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as {
    language?: string;
    autoApprove?: boolean;
    concurrency?: number;
    plannerMaxSteps?: number;
    workerMaxSteps?: number;
    traceSearchLimit?: number;
  };
  await repo.updateSystemSettings({
    language: payloadLanguage(body.language),
    autoApprove: body.autoApprove,
    concurrency: body.concurrency,
    plannerMaxSteps: body.plannerMaxSteps,
    workerMaxSteps: body.workerMaxSteps,
    traceSearchLimit: body.traceSearchLimit,
  });
  return Response.json({ settings: await repo.getSystemSettings() });
}

function payloadLanguage(value: string | undefined): Language | undefined {
  return LANGUAGES.includes(value as Language) ? (value as Language) : undefined;
}
