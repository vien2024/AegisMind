import * as repo from "./repo";
import { seedDemoData } from "./seed";
import type { AssetKind, Language, Task } from "./types";

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export function classifyTarget(target: string): { kind: AssetKind; value: string } {
  const trimmed = target.trim();
  if (/^https?:\/\//i.test(trimmed)) return { kind: "endpoint", value: trimmed };
  if (IP_RE.test(trimmed)) return { kind: "ip", value: trimmed };
  return { kind: "root_domain", value: trimmed.replace(/\/$/, "") };
}

export async function ensureDefaultCompany() {
  const companies = await repo.listCompanies();
  if (companies.length) return companies[0]!;
  return repo.createCompany(
    "Default",
    "Auto-created company for assets discovered during exploration.",
  );
}

export async function createTaskFromInput(input: {
  name: string;
  target: string;
  description?: string;
  goal?: string;
  language?: Language;
  concurrency?: number;
  autoApprove?: boolean;
}): Promise<Task> {
  await seedDemoData();
  const task = await repo.createTask(input);
  const company = await ensureDefaultCompany();
  const { kind, value } = classifyTarget(input.target);
  const { asset } = await repo.upsertAsset({
    companyId: company.id,
    kind,
    value,
    attributes: { source: "task-target" },
  });
  await repo.addTaskScope(task.id, [asset.id]);
  await repo.createNode({
    taskId: task.id,
    kind: "goal",
    title: input.goal?.trim() || `Map the attack surface of ${value} and record findings.`,
    content: input.description ?? undefined,
    status: "pending",
  });
  return task;
}

export async function taskGraph(taskId: number) {
  const nodes = await repo.listNodes(taskId, undefined, 1000);
  const edges = await repo.listEdges(taskId);
  const anchors = await Promise.all(
    nodes.map(async (node) => ({
      node_id: node.id,
      asset_ids: await repo.listAnchoredAssetIds(node.id),
    })),
  );
  const assetIds = new Set(anchors.flatMap((anchor) => anchor.asset_ids));
  const assets = (await Promise.all(
    [...assetIds].map((id) => repo.getAsset(id)),
  ))
    .filter((asset): asset is NonNullable<typeof asset> => asset != null)
    .map((asset) => ({ id: asset.id, kind: asset.kind, value: asset.value }));
  return { nodes, edges, anchors, assets };
}

export async function coverageReport(taskId: number) {
  const scope = await repo.listScopeAssets(taskId);
  const tested = new Set<number>();
  for (const asset of scope) {
    for (const nodeId of await repo.listNodeIdsForAsset(asset.id)) {
      const node = await repo.getNode(nodeId);
      if (node && ["intent", "fact", "finding"].includes(node.kind)) tested.add(asset.id);
    }
  }
  return scope.map((asset) => ({ ...asset, tested: tested.has(asset.id) }));
}
