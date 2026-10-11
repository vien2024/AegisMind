import { db, now, parseJson, getSetting, setSetting } from "./db";
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

export function listCompanies(): Company[] {
  return db().prepare("SELECT * FROM companies ORDER BY id").all() as Company[];
}

export function getCompany(id: number): Company | undefined {
  return db().prepare("SELECT * FROM companies WHERE id = ?").get(id) as
    | Company
    | undefined;
}

export function createCompany(name: string, description?: string): Company {
  const info = db()
    .prepare(
      "INSERT INTO companies (name, description, created_at) VALUES (?, ?, ?)",
    )
    .run(name, description ?? null, now());
  return getCompany(Number(info.lastInsertRowid))!;
}

/* ------------------------------------------------------------------ */
/* Asset graph                                                         */
/* ------------------------------------------------------------------ */

function assetRow(row: unknown): Asset {
  const r = row as Asset & { attributes: string | null };
  return { ...r, attributes: parseJson<Record<string, unknown> | null>(r.attributes, null) };
}

export function listAssets(filter?: {
  companyId?: number;
  kind?: AssetKind;
  search?: string;
  parentId?: number | null;
}): Asset[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter?.companyId) {
    clauses.push("company_id = ?");
    params.push(filter.companyId);
  }
  if (filter?.kind) {
    clauses.push("kind = ?");
    params.push(filter.kind);
  }
  if (filter?.search) {
    clauses.push("value LIKE ?");
    params.push(`%${filter.search}%`);
  }
  if (filter?.parentId !== undefined) {
    if (filter.parentId === null) clauses.push("parent_id IS NULL");
    else {
      clauses.push("parent_id = ?");
      params.push(filter.parentId);
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db()
    .prepare(`SELECT * FROM assets ${where} ORDER BY kind, value`)
    .all(...params);
  return rows.map(assetRow);
}

export function getAsset(id: number): Asset | undefined {
  const row = db().prepare("SELECT * FROM assets WHERE id = ?").get(id);
  return row ? assetRow(row) : undefined;
}

export function upsertAsset(input: {
  companyId: number | null;
  kind: AssetKind;
  value: string;
  parentId?: number | null;
  attributes?: Record<string, unknown>;
}): { asset: Asset; created: boolean } {
  const value = input.value.trim();
  const parentId = input.parentId ?? null;
  const dedupKey = `${input.kind}:${value.toLowerCase()}@${parentId ?? "root"}`;
  const existing = db()
    .prepare("SELECT * FROM assets WHERE dedup_key = ?")
    .get(dedupKey);
  if (existing) return { asset: assetRow(existing), created: false };

  const info = db()
    .prepare(
      `INSERT INTO assets (company_id, kind, value, parent_id, dedup_key, attributes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
  return { asset: getAsset(Number(info.lastInsertRowid))!, created: true };
}

export function assetChildren(id: number): Asset[] {
  return (
    db().prepare("SELECT * FROM assets WHERE parent_id = ? ORDER BY kind, value").all(id) as unknown[]
  ).map(assetRow);
}

/* ------------------------------------------------------------------ */
/* Task scope                                                          */
/* ------------------------------------------------------------------ */

export function addTaskScope(taskId: number, assetIds: number[]): void {
  const stmt = db().prepare(
    "INSERT OR IGNORE INTO task_scope (task_id, asset_id) VALUES (?, ?)",
  );
  const tx = db().transaction((ids: number[]) => {
    for (const id of ids) stmt.run(taskId, id);
  });
  tx(assetIds);
}

export function listScopeAssets(taskId: number): Asset[] {
  const rows = db()
    .prepare(
      `SELECT a.* FROM assets a
       JOIN task_scope s ON s.asset_id = a.id
       WHERE s.task_id = ?
       ORDER BY a.kind, a.value`,
    )
    .all(taskId) as unknown[];
  return rows.map(assetRow);
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

function taskRow(row: unknown): Task {
  const r = row as Task & { todolist: string | null };
  return { ...r, todolist: parseJson<TodoItem[] | null>(r.todolist, null) };
}

export function listTasks(): Task[] {
  return (
    db().prepare("SELECT * FROM tasks ORDER BY created_at DESC").all() as unknown[]
  ).map(taskRow);
}

export function getTask(id: number): Task | undefined {
  const row = db().prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  return row ? taskRow(row) : undefined;
}

export function createTask(input: {
  name: string;
  target: string;
  description?: string;
  goal?: string;
  language?: Language;
  concurrency?: number;
  autoApprove?: boolean;
}): Task {
  const info = db()
    .prepare(
      `INSERT INTO tasks (name, target, description, goal, status, language, concurrency, auto_approve, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      input.target,
      input.description ?? null,
      input.goal ?? null,
      input.language ?? "en",
      input.concurrency ?? 3,
      input.autoApprove === false ? 0 : 1,
      now(),
      now(),
    );
  return getTask(Number(info.lastInsertRowid))!;
}

export function updateTask(id: number, patch: Partial<Task>): void {
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
    "auto_approve",
    "error",
    "started_at",
    "finished_at",
  ];
  for (const key of writable) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(patch[key]);
    }
  }
  if (patch.todolist !== undefined) {
    fields.push("todolist = ?");
    params.push(patch.todolist ? JSON.stringify(patch.todolist) : null);
  }
  fields.push("updated_at = ?");
  params.push(now());
  params.push(id);
  db().prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...params);
}

export function setTaskStatus(id: number, status: TaskStatus, error?: string): void {
  const extra: Partial<Task> = {};
  if (status === "running") extra.started_at = getTask(id)?.started_at ?? now();
  if (["completed", "failed", "stopped"].includes(status)) extra.finished_at = now();
  updateTask(id, { status, error: error ?? null, ...extra });
}

export function deleteTask(id: number): void {
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM activity WHERE task_id = ?").run(id);
    d.prepare("DELETE FROM traffic WHERE task_id = ?").run(id);
    d.prepare("DELETE FROM approvals WHERE task_id = ?").run(id);
    d.prepare("DELETE FROM findings WHERE task_id = ?").run(id);
    d.prepare("DELETE FROM task_scope WHERE task_id = ?").run(id);
    d.prepare(
      "DELETE FROM exploration_anchors WHERE node_id IN (SELECT id FROM exploration_nodes WHERE task_id = ?)",
    ).run(id);
    d.prepare("DELETE FROM exploration_edges WHERE task_id = ?").run(id);
    d.prepare("DELETE FROM exploration_nodes WHERE task_id = ?").run(id);
    d.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  })();
}

/* ------------------------------------------------------------------ */
/* Exploration graph                                                   */
/* ------------------------------------------------------------------ */

function nodeRow(row: unknown): ExplorationNode {
  const r = row as ExplorationNode & { data: string | null };
  return { ...r, data: parseJson<Record<string, unknown> | null>(r.data, null) };
}

export function createNode(input: {
  taskId: number;
  kind: NodeKind;
  title: string;
  content?: string;
  status?: NodeStatus;
  data?: Record<string, unknown>;
}): ExplorationNode {
  const info = db()
    .prepare(
      `INSERT INTO exploration_nodes (task_id, kind, title, content, status, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
  return getNode(Number(info.lastInsertRowid))!;
}

export function getNode(id: number): ExplorationNode | undefined {
  const row = db().prepare("SELECT * FROM exploration_nodes WHERE id = ?").get(id);
  return row ? nodeRow(row) : undefined;
}

export function listNodes(
  taskId: number,
  kind?: NodeKind,
  limit = 500,
): ExplorationNode[] {
  const rows = kind
    ? db()
        .prepare(
          "SELECT * FROM exploration_nodes WHERE task_id = ? AND kind = ? ORDER BY id DESC LIMIT ?",
        )
        .all(taskId, kind, limit)
    : db()
        .prepare(
          "SELECT * FROM exploration_nodes WHERE task_id = ? ORDER BY id DESC LIMIT ?",
        )
        .all(taskId, limit);
  return (rows as unknown[]).map(nodeRow);
}

export function updateNodeStatus(id: number, status: NodeStatus): void {
  db().prepare("UPDATE exploration_nodes SET status = ? WHERE id = ?").run(status, id);
}

export function addEdge(
  taskId: number,
  fromId: number,
  toId: number,
  relation: EdgeRelation,
): void {
  db()
    .prepare(
      "INSERT INTO exploration_edges (task_id, from_id, to_id, relation, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(taskId, fromId, toId, relation, now());
}

export function listEdges(taskId: number): ExplorationEdge[] {
  return db()
    .prepare("SELECT * FROM exploration_edges WHERE task_id = ? ORDER BY id")
    .all(taskId) as ExplorationEdge[];
}

export function addAnchor(nodeId: number, assetIds: number[]): void {
  const stmt = db().prepare(
    "INSERT OR IGNORE INTO exploration_anchors (node_id, asset_id) VALUES (?, ?)",
  );
  const tx = db().transaction((ids: number[]) => {
    for (const id of ids) stmt.run(nodeId, id);
  });
  tx(assetIds);
}

export function listAnchoredAssetIds(nodeId: number): number[] {
  const rows = db()
    .prepare("SELECT asset_id FROM exploration_anchors WHERE node_id = ?")
    .all(nodeId) as { asset_id: number }[];
  return rows.map((r) => r.asset_id);
}

export function listNodeIdsForAsset(assetId: number): number[] {
  const rows = db()
    .prepare("SELECT node_id FROM exploration_anchors WHERE asset_id = ?")
    .all(assetId) as { node_id: number }[];
  return rows.map((r) => r.node_id);
}

export function nodeKindCounts(taskId: number): Record<string, number> {
  const rows = db()
    .prepare(
      "SELECT kind, COUNT(*) as n FROM exploration_nodes WHERE task_id = ? GROUP BY kind",
    )
    .all(taskId) as { kind: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
}

/* ------------------------------------------------------------------ */
/* Activity / worker traces                                            */
/* ------------------------------------------------------------------ */

function activityRow(row: unknown): ActivityRecord {
  const r = row as ActivityRecord & { data: string | null };
  return { ...r, data: parseJson<Record<string, unknown> | null>(r.data, null) };
}

export function addActivity(input: {
  taskId: number;
  intentId?: number | null;
  step?: number | null;
  role: string;
  type: string;
  title: string;
  content?: string;
  data?: Record<string, unknown>;
}): ActivityRecord {
  const info = db()
    .prepare(
      `INSERT INTO activity (task_id, intent_id, step, role, type, title, content, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  const row = db().prepare("SELECT * FROM activity WHERE id = ?").get(Number(info.lastInsertRowid));
  return activityRow(row);
}

export function listActivity(taskId: number, limit = 200): ActivityRecord[] {
  const rows = db()
    .prepare(
      "SELECT * FROM activity WHERE task_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(taskId, limit);
  return (rows as unknown[]).map(activityRow).reverse();
}

export function listIntentActivity(intentId: number): ActivityRecord[] {
  const rows = db()
    .prepare("SELECT * FROM activity WHERE intent_id = ? ORDER BY step, id")
    .all(intentId);
  return (rows as unknown[]).map(activityRow);
}

export function searchWorkerTraces(
  taskId: number,
  query: string,
  excludeIntentId?: number,
  limit = 40,
): ActivityRecord[] {
  const like = `%${query}%`;
  const rows = db()
    .prepare(
      `SELECT * FROM activity
       WHERE task_id = ? AND intent_id IS NOT NULL AND intent_id != ?
         AND (title LIKE ? OR content LIKE ?)
       ORDER BY id DESC LIMIT ?`,
    )
    .all(taskId, excludeIntentId ?? -1, like, like, limit);
  return (rows as unknown[]).map(activityRow);
}

export function listWorkerIntentIds(taskId: number): { intent_id: number; steps: number }[] {
  return db()
    .prepare(
      `SELECT intent_id, COUNT(*) as steps FROM activity
       WHERE task_id = ? AND intent_id IS NOT NULL
       GROUP BY intent_id ORDER BY intent_id`,
    )
    .all(taskId) as { intent_id: number; steps: number }[];
}

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */

export function createFinding(input: {
  taskId: number | null;
  assetId: number | null;
  nodeId: number | null;
  title: string;
  severity: Severity;
  description?: string;
  evidence?: string;
}): Finding {
  const info = db()
    .prepare(
      `INSERT INTO findings (task_id, asset_id, node_id, title, severity, status, description, evidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    )
    .run(
      input.taskId,
      input.assetId,
      input.nodeId,
      input.title,
      input.severity,
      input.description ?? null,
      input.evidence ?? null,
      now(),
      now(),
    );
  return db()
    .prepare("SELECT * FROM findings WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as Finding;
}

export function listFindings(taskId?: number): Finding[] {
  return (
    taskId
      ? db()
          .prepare("SELECT * FROM findings WHERE task_id = ? ORDER BY id DESC")
          .all(taskId)
      : db().prepare("SELECT * FROM findings ORDER BY id DESC").all()
  ) as Finding[];
}

export function getFinding(id: number): Finding | undefined {
  return db().prepare("SELECT * FROM findings WHERE id = ?").get(id) as
    | Finding
    | undefined;
}

export function updateFinding(id: number, patch: Partial<Finding>): void {
  const allowed: (keyof Finding)[] = [
    "status",
    "disposition",
    "severity",
    "fix_version",
    "description",
    "evidence",
  ];
  const fields: string[] = [];
  const params: unknown[] = [];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(patch[key]);
    }
  }
  if (!fields.length) return;
  fields.push("updated_at = ?");
  params.push(now(), id);
  db().prepare(`UPDATE findings SET ${fields.join(", ")} WHERE id = ?`).run(...params);
}

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */

export function createApproval(input: {
  taskId: number;
  intentId: number | null;
  tool: string;
  args: Record<string, unknown>;
  reason?: string;
  status: string;
}): Approval {
  const info = db()
    .prepare(
      `INSERT INTO approvals (task_id, intent_id, tool, args, reason, status, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
  return db()
    .prepare("SELECT * FROM approvals WHERE id = ?")
    .get(Number(info.lastInsertRowid)) as Approval;
}

export function listApprovals(taskId?: number): Approval[] {
  return (
    taskId
      ? db()
          .prepare("SELECT * FROM approvals WHERE task_id = ? ORDER BY id DESC")
          .all(taskId)
      : db().prepare("SELECT * FROM approvals ORDER BY id DESC").all()
  ) as Approval[];
}

export function findDecidedApproval(
  taskId: number,
  intentId: number | null,
  tool: string,
): Approval | undefined {
  if (intentId === null) return undefined;
  return db()
    .prepare(
      `SELECT * FROM approvals
       WHERE task_id = ? AND intent_id = ? AND tool = ? AND status IN ('approved','auto_approved','denied')
       ORDER BY id DESC LIMIT 1`,
    )
    .get(taskId, intentId, tool) as Approval | undefined;
}

export function setApprovalStatus(id: number, status: string): void {
  db()
    .prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?")
    .run(status, now(), id);
}

/* ------------------------------------------------------------------ */
/* Traffic                                                             */
/* ------------------------------------------------------------------ */

export function addTraffic(input: {
  taskId: number;
  intentId: number | null;
  method: string;
  url: string;
  status: number | null;
  request?: string;
  response?: string;
}): void {
  db()
    .prepare(
      `INSERT INTO traffic (task_id, intent_id, method, url, status, request, response, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

export function listTraffic(taskId?: number, limit = 200): TrafficRecord[] {
  return (
    taskId
      ? db()
          .prepare("SELECT * FROM traffic WHERE task_id = ? ORDER BY id DESC LIMIT ?")
          .all(taskId, limit)
      : db()
          .prepare("SELECT * FROM traffic ORDER BY id DESC LIMIT ?")
          .all(limit)
  ) as TrafficRecord[];
}

/* ------------------------------------------------------------------ */
/* LLM configuration                                                   */
/* ------------------------------------------------------------------ */

export function listLlmConfigs(): LlmConfig[] {
  return db()
    .prepare("SELECT * FROM llm_configs ORDER BY id")
    .all() as LlmConfig[];
}

export function getLlmConfig(id: number): LlmConfig | undefined {
  return db().prepare("SELECT * FROM llm_configs WHERE id = ?").get(id) as
    | LlmConfig
    | undefined;
}

export function getActiveLlmConfig(): LlmConfig | undefined {
  return db()
    .prepare("SELECT * FROM llm_configs WHERE is_active = 1 ORDER BY id LIMIT 1")
    .get() as LlmConfig | undefined;
}

export function createLlmConfig(input: {
  name: string;
  provider: LlmConfig["provider"];
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  activate?: boolean;
}): LlmConfig {
  const d = db();
  const info = d
    .prepare(
      `INSERT INTO llm_configs (name, provider, model, base_url, api_key, temperature, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
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
  const id = Number(info.lastInsertRowid);
  if (input.activate) setActiveLlmConfig(id);
  return getLlmConfig(id)!;
}

export function setActiveLlmConfig(id: number): void {
  const d = db();
  d.transaction(() => {
    d.prepare("UPDATE llm_configs SET is_active = 0").run();
    d.prepare("UPDATE llm_configs SET is_active = 1 WHERE id = ?").run(id);
  })();
}

export function deleteLlmConfig(id: number): void {
  db().prepare("DELETE FROM llm_configs WHERE id = ?").run(id);
}

/* ------------------------------------------------------------------ */
/* LLM usage                                                           */
/* ------------------------------------------------------------------ */

export function recordUsage(input: {
  taskId: number | null;
  role: string;
  provider: string;
  model: string;
  live: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): void {
  db()
    .prepare(
      `INSERT INTO llm_usage (task_id, role, provider, model, live, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.taskId,
      input.role,
      input.provider,
      input.model,
      input.live ? 1 : 0,
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

export function listUsage(limit = 200): UsageRow[] {
  return db()
    .prepare("SELECT * FROM llm_usage ORDER BY id DESC LIMIT ?")
    .all(limit) as UsageRow[];
}

export function usageByModel(): Array<{
  model: string;
  provider: string;
  live: number;
  runs: number;
  input: number;
  output: number;
  cacheRead: number;
  total: number;
}> {
  const rows = db()
    .prepare(
      `SELECT model, provider, MAX(live) as live, COUNT(*) as runs,
              SUM(input_tokens) as input, SUM(output_tokens) as output,
              SUM(cache_read_tokens) as cacheRead,
              SUM(input_tokens + output_tokens + cache_read_tokens) as total
       FROM llm_usage GROUP BY model, provider ORDER BY total DESC`,
    )
    .all() as Array<{
    model: string;
    provider: string;
    live: number;
    runs: number;
    input: number;
    output: number;
    cacheRead: number;
    total: number;
  }>;
  return rows;
}

export function usageTotals(model?: string) {
  const row = db()
    .prepare(
      `SELECT COUNT(*) as runs,
              COUNT(DISTINCT task_id) as tasks,
              COALESCE(SUM(input_tokens), 0) as input,
              COALESCE(SUM(output_tokens), 0) as output,
              COALESCE(SUM(cache_read_tokens), 0) as cacheRead,
              COALESCE(SUM(cache_write_tokens), 0) as cacheWrite,
              COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens), 0) as total
       FROM llm_usage${model ? " WHERE model = ?" : ""}`,
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

export function usageSeries(sinceIso: string, bucket: "day" | "month", model?: string) {
  const key = bucket === "day" ? "substr(created_at, 1, 10)" : "substr(created_at, 1, 7)";
  const filter = model ? "AND model = ?" : "";
  return db()
    .prepare(
      `SELECT ${key} as bucket,
              COALESCE(SUM(input_tokens), 0) as input,
              COALESCE(SUM(output_tokens), 0) as output,
              COALESCE(SUM(cache_read_tokens), 0) as cacheRead
       FROM llm_usage WHERE created_at >= ? ${filter}
       GROUP BY bucket ORDER BY bucket`,
    )
    .all(sinceIso, ...(model ? [model] : [])) as Array<{
    bucket: string;
    input: number;
    output: number;
    cacheRead: number;
  }>;
}

/* ------------------------------------------------------------------ */
/* System settings                                                     */
/* ------------------------------------------------------------------ */

export function getSystemSettings() {
  return {
    language: getSetting("language") ?? "en",
    autoApprove: (getSetting("auto_approve") ?? "1") === "1",
    concurrency: Number(getSetting("concurrency") ?? "3"),
    plannerMaxSteps: Number(getSetting("planner_max_steps") ?? "8"),
    workerMaxSteps: Number(getSetting("worker_max_steps") ?? "12"),
    traceSearchLimit: Number(getSetting("trace_search_limit") ?? "40"),
  };
}

export function updateSystemSettings(patch: {
  language?: string;
  autoApprove?: boolean;
  concurrency?: number;
  plannerMaxSteps?: number;
  workerMaxSteps?: number;
  traceSearchLimit?: number;
}): void {
  if (patch.language !== undefined) setSetting("language", patch.language);
  if (patch.autoApprove !== undefined)
    setSetting("auto_approve", patch.autoApprove ? "1" : "0");
  if (patch.concurrency !== undefined)
    setSetting("concurrency", String(clamp(patch.concurrency, 1, 10)));
  if (patch.plannerMaxSteps !== undefined)
    setSetting("planner_max_steps", String(clamp(patch.plannerMaxSteps, 1, 30)));
  if (patch.workerMaxSteps !== undefined)
    setSetting("worker_max_steps", String(clamp(patch.workerMaxSteps, 1, 40)));
  if (patch.traceSearchLimit !== undefined)
    setSetting("trace_search_limit", String(clamp(patch.traceSearchLimit, 1, 200)));
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}
