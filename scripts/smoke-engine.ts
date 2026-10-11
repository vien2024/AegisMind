import { startTask, taskStatus } from "../lib/engine";
import * as repo from "../lib/repo";
import { seedDemoData } from "../lib/seed";

async function main() {
  seedDemoData();
  const company = repo.listCompanies()[0]!;
  const root = repo.upsertAsset({ companyId: company.id, kind: "root_domain", value: "demo.example.com" }).asset;
  const task = repo.createTask({
    name: "Smoke run",
    target: "demo.example.com",
    goal: "Map the attack surface of demo.example.com and record findings.",
    concurrency: 2,
  });
  repo.addTaskScope(task.id, [root.id]);
  repo.createNode({ taskId: task.id, kind: "goal", title: task.goal!, status: "pending" });

  startTask(task.id);

  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    const status = taskStatus(task.id);
    if (status && ["completed", "failed", "stopped"].includes(status)) break;
  }

  const finalStatus = taskStatus(task.id);
  const nodes = repo.listNodes(task.id, undefined, 500);
  const kinds: Record<string, number> = {};
  for (const n of nodes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;

  console.log("status:", finalStatus);
  console.log("nodes:", JSON.stringify(kinds));
  console.log("findings:", repo.listFindings(task.id).length);
  console.log("traffic:", repo.listTraffic(task.id).length);
  console.log("activity:", repo.listActivity(task.id, 500).length);

  if (finalStatus !== "completed") throw new Error("engine did not complete");
  if ((kinds.intent ?? 0) < 1) throw new Error("no intents were created");
  if ((kinds.fact ?? 0) < 1) throw new Error("no facts were created");
  console.log("ENGINE SMOKE OK");
}

main().catch((err) => {
  console.error("ENGINE SMOKE FAILED:", err);
  process.exit(1);
});
