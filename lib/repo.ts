import { db, now, parseJson, getSetting, setSetting, type TransactionClient } from "./db";
export { resolveDbPath } from "./db";
import type {
  ActivityRecord,
  Approval,
  Asset,
  AssetKind,
  Company,
  EdgeRelation,
  ExplorationEdge,
  ExplorationNode,
  Finding,
  Language,
  LlmConfig,
  NodeKind,
  NodeStatus,
  Severity,
  Task,
  TaskStatus,
  TodoItem,
  TrafficRecord,
} from "./types";

/* ------------------------------------------------------------------ */
/* Companies                                                           */
/* ------------------------------------------------------------------ */

export async function listCompanies(): Promise<Company[]> {
  const rows = await db()
    .prepare("SELECT * FROM companies ORDER BY id")
    .all();
  return rows as unknown as Company[];
}

export async function getCompany(id: number): Promise<Company | undefined> {
  const row = await db()
    .prepare("SELECT * FROM companies WHERE id = $1")
    .get(id);
  return row as unknown as Company | undefined;
}

export async function createCompany(
  name: string,
  description?: string,
): Promise<Company> {
  const info = await db()
    .prepare(
      "INSERT INTO companies (name, description, created_at) VALUES ($1, $2, $3) RETURNING id",
    )
    .run(name, description ?? null, now());
  const id = info.lastInsertRowid;
  return (await getCompany(id))!;
}

/* ------------------------------------------------------------------ */
/* Asset graph                                                         */
/* ------------------------------------------------------------------ */

function assetRow(row: unknown): Asset {
  const r = row as unknown as Asset & { attributes: string | null };
  return {
    ...r,
    attributes: parseJson<Record<string, unknown> | null>(r.attributes, null),
  };
}

export async function listAssets(filter?: {
  companyId?: number;
  kind?: AssetKind;
  search?: string;
  parentId?: number | null;
}): Promise<Asset[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter?.companyId) {
    clauses.push("company_id = $" + (params.length + 1));
    params.push(filter.companyId);
  }
  if (filter?.kind) {
    clauses.push("kind = $" + (params.length + 1));
    params.push(filter.kind);
  }
  if (filter?.search) {
    clauses.push("value LIKE $" + (params.length + 1));
    params.push(`%${filter.search}%`);
  }
  if (filter?.parentId !== undefined) {
    if (filter.parentId === null) clauses.push("parent_id IS NULL");
    else {
      clauses.push("parent_id = $" + (params.length + 1));
      params.push(filter.parentId);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT * FROM assets ${where} ORDER BY kind, value`;
  const rows = await db().prepare(sql).all(...params);
  return rows.map(assetRow);
}

export async function assetKindCounts(): Promise<{ total: number; byKind: Record<string, number> }> {
  const rows = await db()
    .prepare("SELECT kind, COUNT(*) AS count FROM assets GROUP BY kind")
    .all() as Array<{ kind: string; count: number | string }>;
  const byKind = Object.fromEntries(rows.map((row) => [row.kind, Number(row.count)]));
  return { total: Object.values(byKind).reduce((sum, count) => sum + count, 0), byKind };
}

export async function getAsset(id: number): Promise<Asset | undefined> {
  const row = await db()
    .prepare("SELECT * FROM assets WHERE id = $1")
    .get(id);
  return row ? assetRow(row) : undefined;
}

export async function upsertAsset(input: {
  companyId: number | null;
  kind: AssetKind;
  value: string;
  parentId?: number | null;
  attributes?: Record<string, unknown>;
}): Promise<{ asset: Asset; created: boolean }> {
  const value = input.value.trim();
  const parentId = input.parentId ?? null;
  const dedupKey = `${input.kind}:${value.toLowerCase()}@${parentId ?? "root"}`;
  const existing = await db()
    .prepare("SELECT * FROM assets WHERE dedup_key = $1")
    .get(dedupKey);
  if (existing) return { asset: assetRow(existing), created: false };

  const info = await db()
    .prepare(
      `INSERT INTO assets (company_id, kind, value, parent_id, dedup_key, attributes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    )
    .run(
      input.companyId,
      input.kind,
      value,
      parentId,
      dedupKey,
      input.attributes ? JSON.stringify(input.attributes) : null,
      now(),
    );
  return { asset: (await getAsset(info.lastInsertRowid))!, created: true };
}

export async function assetChildren(id: number): Promise<Asset[]> {
  const rows = await db()
    .prepare("SELECT * FROM assets WHERE parent_id = $1 ORDER BY kind, value")
    .all(id);
  return rows.map(assetRow);
}

/* ------------------------------------------------------------------ */
/* Task scope                                                          */
/* ------------------------------------------------------------------ */

export async function addTaskScope(taskId: number, assetIds: number[]): Promise<void> {
  await db().transaction(async (client: TransactionClient) => {
    for (const id of assetIds) {
      await client
        .prepare(
          "INSERT INTO task_scope (task_id, asset_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .run(taskId, id);
    }
  });
}

export async function listScopeAssets(taskId: number): Promise<Asset[]> {
  const rows = await db()
    .prepare(
      `SELECT a.* FROM assets a
       JOIN task_scope s ON s.asset_id = a.id
       WHERE s.task_id = $1
       ORDER BY a.kind, a.value`,
    )
    .all(taskId);
  return rows.map(assetRow);
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

function taskRow(row: unknown): Task {
  const r = row as unknown as Task & { todolist: string | null; auto_approve: boolean | number };
  return {
    ...r,
    todolist: parseJson<TodoItem[] | null>(r.todolist, null),
    auto_approve:
      Boolean(r.auto_approve) ? 1 : 0,
  };
}

export async function listTasks(): Promise<Task[]> {
  const rows = await db()
    .prepare("SELECT * FROM tasks ORDER BY created_at DESC")
    .all();
  return (rows as unknown[]).map(taskRow);
}

export async function listTaskSummaries(): Promise<Array<{ status: string; count: number }>> {
  const rows = await db()
    .prepare("SELECT status, COUNT(*) AS count FROM tasks GROUP BY status")
    .all() as Array<{ status: string; count: number | string }>;
  return rows.map((row) => ({ status: row.status, count: Number(row.count) }));
}

export async function getTask(id: number): Promise<Task | undefined> {
  const row = await db()
    .prepare("SELECT * FROM tasks WHERE id = $1")
    .get(id);
  return row ? taskRow(row) : undefined;
}

export async function createTask(input: {
  name: string;
  target: string;
  description?: string;
  goal?: string;
  language?: Language;
  concurrency?: number;
  timeLimitMinutes?: number | null;
  autoApprove?: boolean;
}): Promise<Task> {
  const info = await db()
    .prepare(
      `INSERT INTO tasks (name, target, description, goal, status, language, concurrency, time_limit_minutes, auto_approve, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $10) RETURNING id`,
    )
    .run(
      input.name,
      input.target,
      input.description ?? null,
      input.goal ?? null,
      input.language ?? "en",
      input.concurrency ?? 3,
      input.timeLimitMinutes ?? null,
      input.autoApprove !== false,
      now(),
      now(),
    );
  return (await getTask(info.lastInsertRowid))!;
}

export async function updateTask(id: number, patch: Partial<Task>): Promise<void> {
  const fields: string[] = [];
  const params: unknown[] = [];
  const writable: (keyof Task)[] = [
    "name",
    "target",
    "description",
    "goal",
    "status",
    "language",
    "concurrency",
    "time_limit_minutes",
    "auto_approve",
    "error",
    "started_at",
    "finished_at",
  ];
  for (const key of writable) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = $${params.length + 1}`);
      let value: unknown = patch[key];
      if (key === "auto_approve") value = value !== 0;
      params.push(value);
    }
  }
  if (patch.todolist !== undefined) {
    fields.push(`todolist = $${params.length + 1}`);
    params.push(patch.todolist ? JSON.stringify(patch.todolist) : null);
  }
  fields.push(`updated_at = $${params.length + 1}`);
  params.push(now());
  params.push(id);
  await db()
    .prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = $${params.length}`)
    .run(...params);
}

export async function setTaskStatus(
  id: number,
  status: TaskStatus,
  error?: string,
): Promise<void> {
  const extra: Partial<Task> = {};
  if (status === "running") {
    const current = await getTask(id);
    extra.started_at = current?.started_at ?? now();
  }
  if (["completed", "failed", "stopped"].includes(status))
    extra.finished_at = now();
  await updateTask(id, { status, error: error ?? null, ...extra });
}

export async function deleteTask(id: number): Promise<void> {
  await db().transaction(async (client: TransactionClient) => {
    await client
      .prepare("DELETE FROM activity WHERE task_id = $1")
      .run(id);
    await client
      .prepare("DELETE FROM traffic WHERE task_id = $1")
      .run(id);
    await client
      .prepare("DELETE FROM approvals WHERE task_id = $1")
      .run(id);
    await client
      .prepare("DELETE FROM findings WHERE task_id = $1")
      .run(id);
    await client
      .prepare("DELETE FROM task_scope WHERE task_id = $1")
      .run(id);
    await client
      .prepare(
        "DELETE FROM exploration_anchors WHERE node_id IN (SELECT id FROM exploration_nodes WHERE task_id = $1)",
      )
      .run(id);
    await client
      .prepare("DELETE FROM exploration_edges WHERE task_id = $1")
      .run(id);
    await client
      .prepare("DELETE FROM exploration_nodes WHERE task_id = $1")
      .run(id);
    await client
      .prepare("DELETE FROM tasks WHERE id = $1")
      .run(id);
  });
}

/* ------------------------------------------------------------------ */
/* Exploration graph                                                   */
/* ------------------------------------------------------------------ */

function nodeRow(row: unknown): ExplorationNode {
  const r = row as unknown as ExplorationNode & { data: string | null };
  return {
    ...r,
    data: parseJson<Record<string, unknown> | null>(r.data, null),
  };
}

export async function createNode(input: {
  taskId: number;
  kind: NodeKind;
  title: string;
  content?: string;
  status?: NodeStatus;
  data?: Record<string, unknown>;
}): Promise<ExplorationNode> {
  const info = await db()
    .prepare(
      `INSERT INTO exploration_nodes (task_id, kind, title, content, status, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    )
    .run(
      input.taskId,
      input.kind,
      input.title,
      input.content ?? null,
      input.status ?? "pending",
      input.data ? JSON.stringify(input.data) : null,
      now(),
    );
  return (await getNode(info.lastInsertRowid))!;
}

export async function getNode(id: number): Promise<ExplorationNode | undefined> {
  const row = await db()
    .prepare("SELECT * FROM exploration_nodes WHERE id = $1")
    .get(id);
  return row ? nodeRow(row) : undefined;
}

export async function listNodes(
  taskId: number,
  kind?: NodeKind,
  limit = 500,
): Promise<ExplorationNode[]> {
  const rows = kind
    ? await db()
      .prepare(
        "SELECT * FROM exploration_nodes WHERE task_id = $1 AND kind = $2 ORDER BY id DESC LIMIT $3",
      )
      .all(taskId, kind, limit)
    : await db()
      .prepare(
        "SELECT * FROM exploration_nodes WHERE task_id = $1 ORDER BY id DESC LIMIT $2",
      )
      .all(taskId, limit);
  return (rows as unknown[]).map(nodeRow);
}

export async function updateNodeStatus(
  id: number,
  status: NodeStatus,
): Promise<void> {
  await db()
    .prepare("UPDATE exploration_nodes SET status = $1 WHERE id = $2")
    .run(status, id);
}

export async function addEdge(
  taskId: number,
  fromId: number,
  toId: number,
  relation: EdgeRelation,
): Promise<void> {
  await db()
    .prepare(
      "INSERT INTO exploration_edges (task_id, from_id, to_id, relation, created_at) VALUES ($1, $2, $3, $4, $5)",
    )
    .run(taskId, fromId, toId, relation, now());
}

export async function listEdges(taskId: number): Promise<ExplorationEdge[]> {
  return db()
    .prepare("SELECT * FROM exploration_edges WHERE task_id = $1 ORDER BY id")
    .all(taskId) as unknown as Promise<ExplorationEdge[]>;
}

export async function addAnchor(
  nodeId: number,
  assetIds: number[],
): Promise<void> {
  await db().transaction(async (client: TransactionClient) => {
    for (const id of assetIds) {
      await client
        .prepare(
          "INSERT INTO exploration_anchors (node_id, asset_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        )
        .run(nodeId, id);
    }
  });
}

export async function listAnchoredAssetIds(
  nodeId: number,
): Promise<number[]> {
  const rows = await db()
    .prepare("SELECT asset_id FROM exploration_anchors WHERE node_id = $1")
    .all(nodeId) as { asset_id: number }[];
  return rows.map((r) => r.asset_id);
}

export async function listAnchorsForNodes(
  nodeIds: number[],
): Promise<Array<{ node_id: number; asset_id: number }>> {
  if (nodeIds.length === 0) return [];
  return db()
    .prepare("SELECT node_id, asset_id FROM exploration_anchors WHERE node_id = ANY($1::int[])")
    .all(nodeIds) as unknown as Promise<Array<{ node_id: number; asset_id: number }>>;
}

export async function listAssetsByIds(ids: number[]): Promise<Asset[]> {
  if (ids.length === 0) return [];
  const rows = await db()
    .prepare("SELECT * FROM assets WHERE id = ANY($1::int[])")
    .all(ids);
  return rows.map(assetRow);
}

export async function listTestedScopeAssetIds(taskId: number): Promise<number[]> {
  const rows = await db()
    .prepare(
      `SELECT DISTINCT scope.asset_id
       FROM task_scope scope
       JOIN exploration_anchors anchor ON anchor.asset_id = scope.asset_id
       JOIN exploration_nodes node ON node.id = anchor.node_id
       WHERE scope.task_id = $1 AND node.task_id = $1
         AND node.kind IN ('intent', 'fact', 'finding')`,
    )
    .all(taskId) as Array<{ asset_id: number }>;
  return rows.map((row) => row.asset_id);
}

export async function listNodeIdsForAsset(
  assetId: number,
): Promise<number[]> {
  const rows = await db()
    .prepare("SELECT node_id FROM exploration_anchors WHERE asset_id = $1")
    .all(assetId) as { node_id: number }[];
  return rows.map((r) => r.node_id);
}

export async function nodeKindCounts(
  taskId: number,
): Promise<Record<string, number>> {
  const rows = await db()
    .prepare(
      "SELECT kind, COUNT(*) as n FROM exploration_nodes WHERE task_id = $1 GROUP BY kind",
    )
    .all(taskId) as { kind: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
}

/* ------------------------------------------------------------------ */
/* Activity / worker traces                                            */
/* ------------------------------------------------------------------ */

function activityRow(row: unknown): ActivityRecord {
  const r = row as ActivityRecord & { data: string | null };
  return {
    ...r,
    data: parseJson<Record<string, unknown> | null>(r.data, null),
  };
}

export async function addActivity(input: {
  taskId: number;
  intentId?: number | null;
  step?: number | null;
  role: string;
  type: string;
  title: string;
  content?: string;
  data?: Record<string, unknown>;
}): Promise<ActivityRecord> {
  const info = await db()
    .prepare(
      `INSERT INTO activity (task_id, intent_id, step, role, type, title, content, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    )
    .run(
      input.taskId,
      input.intentId ?? null,
      input.step ?? null,
      input.role,
      input.type,
      input.title,
      input.content ?? null,
      input.data ? JSON.stringify(input.data) : null,
      now(),
    );
  const row = await db()
    .prepare("SELECT * FROM activity WHERE id = $1")
    .get(info.lastInsertRowid);
  return activityRow(row as unknown);
}

export async function listActivity(
  taskId: number,
  limit = 200,
): Promise<ActivityRecord[]> {
  const rows = await db()
    .prepare(
      "SELECT * FROM activity WHERE task_id = $1 ORDER BY id DESC LIMIT $2",
    )
    .all(taskId, limit);
  return (rows as unknown[]).map(activityRow).reverse();
}

export async function listRecentActivity(
  limit: number,
): Promise<Array<ActivityRecord & { task_name: string | null }>> {
  const rows = await db()
    .prepare(
      `SELECT activity.*, tasks.name AS task_name
       FROM activity
       LEFT JOIN tasks ON tasks.id = activity.task_id
       ORDER BY activity.id DESC
       LIMIT $1`,
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...activityRow(row),
    task_name: typeof row.task_name === "string" ? row.task_name : null,
  }));
}

export async function listIntentActivity(
  intentId: number,
): Promise<ActivityRecord[]> {
  const rows = await db()
    .prepare("SELECT * FROM activity WHERE intent_id = $1 ORDER BY step, id")
    .all(intentId);
  return (rows as unknown[]).map(activityRow);
}

export async function searchWorkerTraces(
  taskId: number,
  query: string,
  excludeIntentId?: number,
  limit = 40,
): Promise<ActivityRecord[]> {
  const like = `%${query}%`;
  const rows = await db()
    .prepare(
      `SELECT * FROM activity
       WHERE task_id = $1 AND intent_id IS NOT NULL AND intent_id != $2
         AND (title LIKE $3 OR content LIKE $3)
       ORDER BY id DESC LIMIT $4`,
    )
    .all(taskId, excludeIntentId ?? -1, like, limit);
  return (rows as unknown[]).map(activityRow);
}

export async function listWorkerIntentIds(
  taskId: number,
): Promise<{ intent_id: number; steps: number }[]> {
  const rows = await db()
    .prepare(
      `SELECT intent_id, COUNT(*) as steps FROM activity
       WHERE task_id = $1 AND intent_id IS NOT NULL
       GROUP BY intent_id ORDER BY intent_id`,
    )
    .all(taskId) as { intent_id: number; steps: number }[];
  return rows;
}

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */

export async function createFinding(input: {
  taskId: number | null;
  assetId: number | null;
  nodeId: number | null;
  title: string;
  severity: Severity;
  description: string;
  reproduction: string;
  location: string;
  impact: string;
  evidence: string;
  observedPayload?: string | null;
  observedResult?: string | null;
}): Promise<Finding> {
  const requiredDetails = ["description", "reproduction", "location", "impact", "evidence"] as const;
  for (const field of requiredDetails) {
    if (typeof input[field] !== "string" || !input[field].trim()) {
      throw new Error(`Finding ${field} is required and cannot be empty.`);
    }
  }
  if ((input.observedPayload?.length ?? 0) > 4096) {
    throw new Error("Finding observed payload cannot exceed 4,096 characters.");
  }
  if ((input.observedResult?.length ?? 0) > 8192) {
    throw new Error("Finding observed result cannot exceed 8,192 characters.");
  }
  const info = await db()
    .prepare(
      `INSERT INTO findings (task_id, asset_id, node_id, title, severity, status, description, reproduction, location, impact, evidence, observed_payload, observed_result, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    )
    .run(
      input.taskId,
      input.assetId,
      input.nodeId,
      input.title,
      input.severity,
      input.description.trim(),
      input.reproduction.trim(),
      input.location.trim(),
      input.impact.trim(),
      input.evidence.trim(),
      input.observedPayload?.trim() || null,
      input.observedResult?.trim() || null,
      now(),
      now(),
    );
  const row = await db()
    .prepare("SELECT * FROM findings WHERE id = $1")
    .get(info.lastInsertRowid);
  return row as unknown as Finding;
}

export async function listFindings(
  taskId?: number,
): Promise<Finding[]> {
  const rows =
    taskId
      ? await db()
        .prepare("SELECT * FROM findings WHERE task_id = $1 ORDER BY id DESC")
        .all(taskId)
      : await db().prepare("SELECT * FROM findings ORDER BY id DESC").all();
  return rows as unknown as Finding[];
}

export async function findingSummary(limit = 8): Promise<{
  total: number;
  confirmed: number;
  pending: number;
  bySeverity: Record<string, number>;
  recent: Array<Finding & { task_name: string | null }>;
}> {
  const [groups, recentRows] = await Promise.all([
    db()
      .prepare("SELECT severity, status, COUNT(*) AS count FROM findings GROUP BY severity, status")
      .all() as Promise<Array<{ severity: string; status: string; count: number | string }>>,
    db()
      .prepare(
        `SELECT findings.*, tasks.name AS task_name
         FROM findings LEFT JOIN tasks ON tasks.id = findings.task_id
         ORDER BY findings.id DESC LIMIT $1`,
      )
      .all(limit) as Promise<Array<Record<string, unknown>>>,
  ]);
  const bySeverity: Record<string, number> = {};
  let total = 0;
  let confirmed = 0;
  let pending = 0;
  for (const group of groups) {
    const count = Number(group.count);
    total += count;
    bySeverity[group.severity] = (bySeverity[group.severity] ?? 0) + count;
    if (group.status === "confirmed") confirmed += count;
    if (group.status === "pending") pending += count;
  }
  return {
    total,
    confirmed,
    pending,
    bySeverity,
    recent: recentRows.map((row) => ({
      ...(row as unknown as Finding),
      task_name: typeof row.task_name === "string" ? row.task_name : null,
    })),
  };
}

export async function getFinding(id: number): Promise<Finding | undefined> {
  const row = await db()
    .prepare("SELECT * FROM findings WHERE id = $1")
    .get(id);
  return row as unknown as Finding | undefined;
}

export async function updateFinding(
  id: number,
  patch: Partial<Finding>,
): Promise<void> {
  const requiredDetails = ["description", "reproduction", "location", "impact", "evidence"] as const;
  for (const field of requiredDetails) {
    const value = patch[field];
    if (value !== undefined && (typeof value !== "string" || !value.trim())) {
      throw new Error(`Finding ${field} cannot be empty.`);
    }
  }
  if (patch.observed_payload !== undefined && patch.observed_payload !== null &&
      (typeof patch.observed_payload !== "string" || patch.observed_payload.length > 4096)) {
    throw new Error("Finding observed payload must be at most 4,096 characters.");
  }
  if (patch.observed_result !== undefined && patch.observed_result !== null &&
      (typeof patch.observed_result !== "string" || patch.observed_result.length > 8192)) {
    throw new Error("Finding observed result must be at most 8,192 characters.");
  }
  const allowed: (keyof Finding)[] = [
    "status",
    "disposition",
    "severity",
    "fix_version",
    "description",
    "reproduction",
    "location",
    "impact",
    "evidence",
    "observed_payload",
    "observed_result",
  ];
  const fields: string[] = [];
  const params: unknown[] = [];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = $${params.length + 1}`);
      const value = patch[key];
      params.push(
        (requiredDetails.includes(key as (typeof requiredDetails)[number]) ||
          key === "observed_payload" ||
          key === "observed_result") &&
        typeof value === "string"
          ? value.trim()
          : value,
      );
    }
  }
  if (!fields.length) return;
  fields.push(`updated_at = $${params.length + 1}`);
  params.push(now());
  params.push(id);
  await db()
    .prepare(`UPDATE findings SET ${fields.join(", ")} WHERE id = $${params.length}`)
    .run(...params);
}

export async function recordFindingValidation(input: {
  findingId: number;
  type: Finding["validator_type"];
  parameter: string;
  payload: string;
  status: Finding["validator_status"];
  result: string;
  description?: string;
}): Promise<void> {
  const confirmed = input.status === "confirmed";
  await db()
    .prepare(
      `UPDATE findings
       SET validator_type = $1, validator_parameter = $2, validator_payload = $3,
           validator_status = $4, validator_result = $5,
           validated_at = CASE WHEN $4 = 'awaiting_approval' THEN validated_at ELSE $6 END,
           status = CASE WHEN $7 THEN 'confirmed' WHEN status IN ('pending', 'potential') THEN 'potential' ELSE status END,
           description = COALESCE($8, description),
           updated_at = $6
       WHERE id = $9`,
    )
    .run(
      input.type,
      input.parameter,
      input.payload,
      input.status,
      input.result,
      now(),
      confirmed,
      input.description ?? null,
      input.findingId,
    );
}

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */

export async function createApproval(input: {
  taskId: number;
  intentId: number | null;
  tool: string;
  args: Record<string, unknown>;
  reason?: string;
  status: string;
}): Promise<Approval> {
  const info = await db()
    .prepare(
      `INSERT INTO approvals (task_id, intent_id, tool, args, reason, status, created_at, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    )
    .run(
      input.taskId,
      input.intentId,
      input.tool,
      JSON.stringify(input.args),
      input.reason ?? null,
      input.status,
      now(),
      input.status === "pending" ? null : now(),
    );
  const row = await db()
    .prepare("SELECT * FROM approvals WHERE id = $1")
    .get(info.lastInsertRowid);
  return row as unknown as Approval;
}

export async function listApprovals(
  taskId?: number,
): Promise<Approval[]> {
  const rows =
    taskId
      ? await db()
        .prepare("SELECT * FROM approvals WHERE task_id = $1 ORDER BY id DESC")
        .all(taskId)
      : await db().prepare("SELECT * FROM approvals ORDER BY id DESC").all();
  return rows as unknown as Approval[];
}

export async function countPendingApprovals(): Promise<number> {
  const row = await db()
    .prepare("SELECT COUNT(*) AS count FROM approvals WHERE status = 'pending'")
    .get() as { count: number | string };
  return Number(row.count);
}

export async function findDecidedApproval(
  taskId: number,
  intentId: number | null,
  tool: string,
): Promise<Approval | undefined> {
  if (intentId === null) return undefined;
  const row = await db()
    .prepare(
      `SELECT * FROM approvals
       WHERE task_id = $1 AND intent_id = $2 AND tool = $3 AND status IN ('approved','auto_approved','denied')
       ORDER BY id DESC LIMIT 1`,
    )
    .get(taskId, intentId, tool);
  return row as unknown as Approval | undefined;
}

export async function setApprovalStatus(
  id: number,
  status: string,
): Promise<void> {
  await db()
    .prepare("UPDATE approvals SET status = $1, decided_at = $2 WHERE id = $3")
    .run(status, now(), id);
}

/* ------------------------------------------------------------------ */
/* Traffic                                                             */
/* ------------------------------------------------------------------ */

export async function addTraffic(input: {
  taskId: number;
  intentId: number | null;
  method: string;
  url: string;
  status: number | null;
  request?: string;
  response?: string;
}): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO traffic (task_id, intent_id, method, url, status, request, response, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    )
    .run(
      input.taskId,
      input.intentId,
      input.method,
      input.url,
      input.status,
      input.request ?? null,
      input.response ?? null,
      now(),
    );
}

export async function listTraffic(
  taskId?: number,
  limit = 200,
): Promise<TrafficRecord[]> {
  const rows =
    taskId
      ? await db()
        .prepare(
          "SELECT * FROM traffic WHERE task_id = $1 ORDER BY id DESC LIMIT $2",
        )
        .all(taskId, limit)
      : await db()
        .prepare("SELECT * FROM traffic ORDER BY id DESC LIMIT $1")
        .all(limit);
  return rows as unknown as TrafficRecord[];
}

export async function countTraffic(): Promise<number> {
  const row = await db()
    .prepare("SELECT COUNT(*) AS count FROM traffic")
    .get() as { count: number | string };
  return Number(row.count);
}

/* ------------------------------------------------------------------ */
/* LLM configuration                                                   */
/* ------------------------------------------------------------------ */

export async function listLlmConfigs(): Promise<LlmConfig[]> {
  const rows = await db()
    .prepare("SELECT * FROM llm_configs ORDER BY id")
    .all();
  return (rows as unknown as (LlmConfig & { is_active: boolean | number })[]).map(normalizeLlmConfig);
}

export async function getLlmConfig(
  id: number,
): Promise<LlmConfig | undefined> {
  const row = await db()
    .prepare("SELECT * FROM llm_configs WHERE id = $1")
    .get(id);
  if (!row) return undefined;
  return normalizeLlmConfig(row as unknown as LlmConfig & { is_active: boolean | number });
}

export async function getActiveLlmConfig(): Promise<LlmConfig | undefined> {
  const row = await db()
    .prepare("SELECT * FROM llm_configs WHERE is_active = true ORDER BY id LIMIT 1")
    .get();
  if (!row) return undefined;
  return normalizeLlmConfig(row as unknown as LlmConfig & { is_active: boolean | number });
}

function normalizeLlmConfig(
  row: LlmConfig & { is_active: boolean | number },
): LlmConfig {
  return {
    ...row,
    is_active:
      Boolean(row.is_active) ? 1 : 0,
  };
}

export async function createLlmConfig(input: {
  name: string;
  provider: LlmConfig["provider"];
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  activate?: boolean;
}): Promise<LlmConfig> {
  const info = await db()
    .prepare(
      `INSERT INTO llm_configs (name, provider, model, base_url, api_key, temperature, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, $7) RETURNING id`,
    )
    .run(
      input.name,
      input.provider,
      input.model,
      input.baseUrl ?? null,
      input.apiKey ?? null,
      input.temperature ?? null,
      now(),
    );
  const id = info.lastInsertRowid;
  const config = (await getLlmConfig(id))!;
  if (input.activate) await setActiveLlmConfig(id);
  return config;
}

export async function setActiveLlmConfig(id: number): Promise<void> {
  await db().transaction(async (client: TransactionClient) => {
    await client
      .prepare("UPDATE llm_configs SET is_active = false")
      .run();
    await client
      .prepare("UPDATE llm_configs SET is_active = true WHERE id = $1")
      .run(id);
  });
}

export async function deleteLlmConfig(id: number): Promise<void> {
  await db()
    .prepare("DELETE FROM llm_configs WHERE id = $1")
    .run(id);
}

/* ------------------------------------------------------------------ */
/* LLM usage                                                           */
/* ------------------------------------------------------------------ */

export async function recordUsage(input: {
  taskId: number | null;
  role: string;
  provider: string;
  model: string;
  live: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO llm_usage (task_id, role, provider, model, live, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    )
    .run(
      input.taskId,
      input.role,
      input.provider,
      input.model,
      input.live,
      input.inputTokens,
      input.outputTokens,
      input.cacheReadTokens,
      input.cacheWriteTokens,
      now(),
    );
}

export interface UsageRow {
  id: number;
  task_id: number | null;
  role: string;
  provider: string;
  model: string;
  live: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  created_at: string;
}

export async function listUsage(limit = 200): Promise<UsageRow[]> {
  const rows = await db()
    .prepare("SELECT * FROM llm_usage ORDER BY id DESC LIMIT $1")
    .all(limit) as unknown as UsageRow[];
  return rows.map(normalizeUsageRow);
}

function normalizeUsageRow(row: UsageRow): UsageRow {
  return {
    ...row,
    live: Boolean(row.live) ? 1 : 0,
  };
}

export async function usageByModel(): Promise<
  Array<{
    model: string;
    provider: string;
    live: number;
    runs: number;
    input: number;
    output: number;
    cacheRead: number;
    total: number;
  }>
> {
  const rows = await db()
    .prepare(
      `SELECT model, provider, BOOL_OR(live) as live, COUNT(*) as runs,
              SUM(input_tokens) as input, SUM(output_tokens) as output,
              SUM(cache_read_tokens) as cacheRead,
              SUM(input_tokens + output_tokens + cache_read_tokens) as total
       FROM llm_usage GROUP BY model, provider ORDER BY total DESC`,
    )
    .all() as Array<{
      model: string;
      provider: string;
      live: boolean | number;
      runs: number;
      input: number;
      output: number;
      cacheRead: number;
      total: number;
    }>;
  return rows.map((r) => ({
    model: r.model,
    provider: r.provider,
    live: Boolean(r.live) ? 1 : 0,
    runs: r.runs,
    input: r.input,
    output: r.output,
    cacheRead: r.cacheRead,
    total: r.total,
  }));
}

export async function usageTotals(model?: string) {
  const row = await db()
    .prepare(
      `SELECT COUNT(*) as runs,
              COUNT(DISTINCT task_id) as tasks,
              COALESCE(SUM(input_tokens), 0) as input,
              COALESCE(SUM(output_tokens), 0) as output,
              COALESCE(SUM(cache_read_tokens), 0) as cacheRead,
              COALESCE(SUM(cache_write_tokens), 0) as cacheWrite,
              COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens), 0) as total
       FROM llm_usage${model ? " WHERE model = $1" : ""}`,
    )
    .get(...(model ? [model] : [])) as {
      runs: number;
      tasks: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  return row;
}

export async function usageSeries(
  sinceIso: string,
  bucket: "day" | "month",
  model?: string,
) {
  const key =
    bucket === "day"
      ? "to_char(created_at::timestamptz, 'YYYY-MM-DD')"
      : "to_char(created_at::timestamptz, 'YYYY-MM')";
  const filter = model ? "AND model = $2" : "";
  const rows = await db()
    .prepare(
      `SELECT ${key} as bucket,
              COALESCE(SUM(input_tokens), 0) as input,
              COALESCE(SUM(output_tokens), 0) as output,
              COALESCE(SUM(cache_read_tokens), 0) as cacheRead
       FROM llm_usage WHERE created_at >= $1 ${filter}
       GROUP BY bucket ORDER BY bucket`,
    )
    .all(sinceIso, ...(model ? [model] : [])) as Array<{
      bucket: string;
      input: number;
      output: number;
      cacheRead: number;
    }>;
  return rows;
}

/* ------------------------------------------------------------------ */
/* System settings                                                     */
/* ------------------------------------------------------------------ */

export async function getSystemSettings() {
  const [language, autoApprove, concurrency, plannerMaxSteps, workerMaxSteps, traceSearchLimit] =
    await Promise.all([
      getSetting("language"),
      getSetting("auto_approve"),
      getSetting("concurrency"),
      getSetting("planner_max_steps"),
      getSetting("worker_max_steps"),
      getSetting("trace_search_limit"),
    ]);
  return {
    language: language ?? "en",
    autoApprove: (autoApprove ?? "1") === "1",
    concurrency: Number(concurrency ?? "3"),
    plannerMaxSteps: Number(plannerMaxSteps ?? "8"),
    workerMaxSteps: Number(workerMaxSteps ?? "12"),
    traceSearchLimit: Number(traceSearchLimit ?? "40"),
  };
}

export async function updateSystemSettings(patch: {
  language?: string;
  autoApprove?: boolean;
  concurrency?: number;
  plannerMaxSteps?: number;
  workerMaxSteps?: number;
  traceSearchLimit?: number;
}): Promise<void> {
  const updates: Array<Promise<void>> = [];
  if (patch.language !== undefined)
    updates.push(setSetting("language", patch.language));
  if (patch.autoApprove !== undefined)
    updates.push(
      setSetting("auto_approve", patch.autoApprove ? "1" : "0"),
    );
  if (patch.concurrency !== undefined)
    updates.push(
      setSetting("concurrency", String(clamp(patch.concurrency, 1, 10))),
    );
  if (patch.plannerMaxSteps !== undefined)
    updates.push(
      setSetting(
        "planner_max_steps",
        String(clamp(patch.plannerMaxSteps, 1, 30)),
      ),
    );
  if (patch.workerMaxSteps !== undefined)
    updates.push(
      setSetting(
        "worker_max_steps",
        String(clamp(patch.workerMaxSteps, 1, 40)),
      ),
    );
  if (patch.traceSearchLimit !== undefined)
    updates.push(
      setSetting(
        "trace_search_limit",
        String(clamp(patch.traceSearchLimit, 1, 200)),
      ),
    );
  await Promise.all(updates);
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}
