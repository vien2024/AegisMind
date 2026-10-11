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

export function ensureDefaultCompany() {
  const companies = repo.listCompanies();
  if (companies.length) return companies[0]!;
  return repo.createCompany("Default", "Auto-created company for assets discovered during exploration.");
}

export function createTaskFromInput(input: {
  name: string;
  target: string;
  description?: string;
  goal?: string;
  language?: Language;
  concurrency?: number;
  autoApprove?: boolean;
}): Task {
  seedDemoData();
  const task = repo.createTask(input);
  const company = ensureDefaultCompany();
  const { kind, value } = classifyTarget(input.target);
  const { asset } = repo.upsertAsset({
    companyId: company.id,
    kind,
    value,
    attributes: { source: "task-target" },
  });
  repo.addTaskScope(task.id, [asset.id]);
  repo.createNode({
    taskId: task.id,
    kind: "goal",
    title: input.goal?.trim() || `Map the attack surface of ${value} and record findings.`,
    content: input.description ?? undefined,
    status: "pending",
  });
  return task;
}

export function taskGraph(taskId: number) {
  const nodes = repo.listNodes(taskId, undefined, 1000);
  const edges = repo.listEdges(taskId);
  const anchors = nodes.map((node) => ({ node_id: node.id, asset_ids: repo.listAnchoredAssetIds(node.id) }));
  const assetIds = new Set(anchors.flatMap((anchor) => anchor.asset_ids));
  const assets = [...assetIds]
    .map((id) => repo.getAsset(id))
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
    .map((asset) => ({ id: asset.id, kind: asset.kind, value: asset.value }));
  return { nodes, edges, anchors, assets };
}

export function coverageReport(taskId: number) {
  const scope = repo.listScopeAssets(taskId);
  const tested = new Set<number>();
  for (const asset of scope) {
    for (const nodeId of repo.listNodeIdsForAsset(asset.id)) {
      const node = repo.getNode(nodeId);
      if (node && ["intent", "fact", "finding"].includes(node.kind)) tested.add(asset.id);
    }
  }
  return scope.map((asset) => ({ ...asset, tested: tested.has(asset.id) }));
}
