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
  timeLimitMinutes?: number | null;
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
  const [edges, anchorRows, scope, testedIds] = await Promise.all([
    repo.listEdges(taskId),
    repo.listAnchorsForNodes(nodes.map((node) => node.id)),
    repo.listScopeAssets(taskId),
    repo.listTestedScopeAssetIds(taskId),
  ]);
  const assetIds = [...new Set(anchorRows.map((anchor) => anchor.asset_id))];
  const assets = await repo.listAssetsByIds(assetIds);
  const anchorsByNode = new Map<number, number[]>();
  for (const anchor of anchorRows) {
    const ids = anchorsByNode.get(anchor.node_id) ?? [];
    ids.push(anchor.asset_id);
    anchorsByNode.set(anchor.node_id, ids);
  }
  const anchors = nodes.map((node) => ({
    node_id: node.id,
    asset_ids: anchorsByNode.get(node.id) ?? [],
  }));
  return {
    nodes,
    edges,
    anchors,
    assets: assets.map((asset) => ({ id: asset.id, kind: asset.kind, value: asset.value })),
    coverage: coverageFromScope(scope, testedIds),
  };
}

function coverageFromScope(
  scope: Awaited<ReturnType<typeof repo.listScopeAssets>>,
  testedIds: number[],
) {
  const tested = new Set(testedIds);
  return scope.map((asset) => ({ ...asset, tested: tested.has(asset.id) }));
}

export async function coverageReport(taskId: number) {
  const [scope, testedIds] = await Promise.all([
    repo.listScopeAssets(taskId),
    repo.listTestedScopeAssetIds(taskId),
  ]);
  return coverageFromScope(scope, testedIds);
}
