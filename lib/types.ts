export const ASSET_KINDS = [
  "root_domain",
  "subdomain",
  "ip",
  "service",
  "app",
  "endpoint",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const NODE_KINDS = ["goal", "intent", "fact", "finding", "hint"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const EDGE_RELATIONS = ["spawns", "derived_from", "yields", "proves"] as const;
export type EdgeRelation = (typeof EDGE_RELATIONS)[number];

export const TASK_STATUSES = [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "stopped",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const NODE_STATUSES = [
  "pending",
  "running",
  "awaiting_approval",
  "done",
  "failed",
  "blocked",
] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const PROVIDERS = ["openai", "anthropic", "openrouter", "orcarouter", "mistral", "ollama", "mock"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const LANGUAGES = ["en", "ko"] as const;
export type Language = (typeof LANGUAGES)[number];

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Company {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Asset {
  id: number;
  company_id: number | null;
  kind: AssetKind;
  value: string;
  parent_id: number | null;
  dedup_key: string;
  attributes: Record<string, unknown> | null;
  created_at: string;
}

export interface Task {
  id: number;
  name: string;
  target: string;
  description: string | null;
  goal: string | null;
  status: TaskStatus;
  language: Language;
  concurrency: number;
  time_limit_minutes: number | null;
  auto_approve: number;
  todolist: TodoItem[] | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface TodoItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "done" | "blocked";
  depends_on?: string[];
}

export interface ExplorationNode {
  id: number;
  task_id: number;
  kind: NodeKind;
  title: string;
  content: string | null;
  status: NodeStatus;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface ExplorationEdge {
  id: number;
  task_id: number;
  from_id: number;
  to_id: number;
  relation: EdgeRelation;
  created_at: string;
}

export interface ActivityRecord {
  id: number;
  task_id: number;
  intent_id: number | null;
  step: number | null;
  role: string;
  type: string;
  title: string;
  content: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

export interface Finding {
  id: number;
  task_id: number | null;
  asset_id: number | null;
  node_id: number | null;
  title: string;
  severity: Severity;
  status: string;
  description: string | null;
  reproduction: string | null;
  location: string | null;
  impact: string | null;
  evidence: string | null;
  observed_payload: string | null;
  observed_result: string | null;
  validator_type: "reflected_xss" | "sql_error" | null;
  validator_parameter: string | null;
  validator_payload: string | null;
  validator_status: "unverified" | "awaiting_approval" | "confirmed" | "potential" | "not_confirmed" | "inconclusive" | "denied" | "blocked";
  validator_result: string | null;
  validated_at: string | null;
  disposition: string | null;
  fix_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface Approval {
  id: number;
  task_id: number | null;
  intent_id: number | null;
  tool: string;
  args: string | null;
  reason: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
}

export interface TrafficRecord {
  id: number;
  task_id: number | null;
  intent_id: number | null;
  method: string;
  url: string;
  status: number | null;
  request: string | null;
  response: string | null;
  created_at: string;
}

export interface LlmConfig {
  id: number;
  name: string;
  provider: ProviderId;
  model: string;
  base_url: string | null;
  api_key: string | null;
  temperature: number | null;
  is_active: number;
  created_at: string;
}

export interface TaskEvent {
  type: string;
  taskId: number | null;
  at: string;
  payload: Record<string, unknown>;
}
