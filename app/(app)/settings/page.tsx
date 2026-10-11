import fs from "node:fs";
import { SettingsClient } from "@/components/settings-client";
import { requirePageUser } from "@/lib/page-auth";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePageUser();
  const active = repo.getActiveLlmConfig();
  const dbPath = repo.resolveDbPath();
  let dbBytes = 0;
  try {
    dbBytes = fs.statSync(dbPath).size;
  } catch {
    dbBytes = 0;
  }

  const tasks = repo.listTasks();

  return (
    <SettingsClient
      initial={{
        settings: repo.getSystemSettings(),
        env: {
          openai: Boolean(process.env.OPENAI_API_KEY),
          anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
          database: dbPath.replace(process.cwd(), "."),
        },
        activeLlm: active
          ? { id: active.id, name: active.name, provider: active.provider, model: active.model }
          : null,
        stats: {
          tasks: tasks.length,
          assets: repo.listAssets().length,
          findings: repo.listFindings().length,
          traffic: repo.listTraffic(undefined, 100000).length,
          activities: tasks.reduce((sum, task) => sum + repo.listActivity(task.id, 100000).length, 0),
          dbBytes,
        },
        version: "0.1.0 (next)",
        runtime: "Next.js · Node",
      }}
    />
  );
}
