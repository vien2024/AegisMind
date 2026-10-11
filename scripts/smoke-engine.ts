import { startTask, taskStatus } from "../lib/engine";
import * as repo from "../lib/repo";
import { seedDemoData } from "../lib/seed";

async function main() {
  await seedDemoData();
  const companies = await repo.listCompanies();
  const company = companies[0]!;
  const root = (await repo.upsertAsset({
    companyId: company.id,
    kind: "root_domain",
    value: "demo.example.com",
  })).asset;
  const task = await repo.createTask({
    name: "Smoke run",
    target: "demo.example.com",
    goal: "Map the attack surface of demo.example.com and record findings.",
    concurrency: 2,
  });
  await repo.addTaskScope(task.id, [root.id]);
  await repo.createNode({
    taskId: task.id,
    kind: "goal",
    title: task.goal!,
    status: "pending",
  });

  await startTask(task.id);

  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    const status = await taskStatus(task.id);
    if (status && ["completed", "failed", "stopped"].includes(status)) break;
  }

  const finalStatus = await taskStatus(task.id);
  const nodes = await repo.listNodes(task.id, undefined, 500);
  const kinds: Record<string, number> = {};
  for (const n of nodes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;

  console.log("status:", finalStatus);
  console.log("nodes:", JSON.stringify(kinds));
  console.log("findings:", (await repo.listFindings(task.id)).length);
  console.log("traffic:", (await repo.listTraffic(task.id)).length);
  console.log("activity:", (await repo.listActivity(task.id, 500)).length);

  if (finalStatus !== "completed") throw new Error("engine did not complete");
  if ((kinds.intent ?? 0) < 1) throw new Error("no intents were created");
  if ((kinds.fact ?? 0) < 1) throw new Error("no facts were created");
  console.log("ENGINE SMOKE OK");
}

main().catch((err) => {
  console.error("ENGINE SMOKE FAILED:", err);
  process.exit(1);
});
