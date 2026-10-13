import { Badge, Card } from "@/components/ui";
import { Icon } from "@/components/shell/icons";

type ToolInfo = {
  name: string;
  description: string;
  approval?: "manual" | "none";
};

const SHARED_EXECUTION_TOOLS: ToolInfo[] = [
  {
    name: "execute_cmd",
    description: "Runs shell commands from the workspace. Timeout: 60 seconds; output is capped. Not sandboxed.",
    approval: "none",
  },
  {
    name: "write_python_file",
    description: "Creates or replaces a simple .py file in agent-python/.",
    approval: "none",
  },
  {
    name: "run_python_file",
    description: "Runs a Python file from agent-python/. Timeout: 60 seconds; output is capped. Not sandboxed.",
    approval: "none",
  },
];

const PLANNER_TOOLS: ToolInfo[] = [
  ...SHARED_EXECUTION_TOOLS,
  { name: "get_graph_overview", description: "Reads task graph counts, open intents, facts, findings and goal." },
  { name: "get_coverage", description: "Lists in-scope assets and whether they have graph evidence." },
  { name: "read_todolist", description: "Reads the shared planner checklist." },
  { name: "update_todolist", description: "Updates the shared planner checklist." },
  { name: "search_assets", description: "Searches assets in the global asset graph." },
  { name: "send_intent", description: "Creates a bounded worker intent anchored to in-scope assets." },
  { name: "dispatch_agents", description: "Dispatches a batch of independent specialist intents for concurrent execution." },
  { name: "prove_goal", description: "Marks the task goal proven with a conclusion." },
];

const WORKER_TOOLS: ToolInfo[] = [
  ...SHARED_EXECUTION_TOOLS,
  { name: "get_intent_context", description: "Reads the worker's assigned intent and anchored scope." },
  { name: "list_scope", description: "Lists assets explicitly in the task scope." },
  { name: "search_all_worker_traces", description: "Searches execution steps from other workers." },
  { name: "list_worker_traces", description: "Lists worker intents with recorded steps." },
  { name: "get_worker_trace", description: "Reads another worker's recorded execution steps." },
  { name: "submit_asset", description: "Records an observed asset and may add eligible child assets to task scope." },
  { name: "submit_fact", description: "Records an evidence-supported fact in the task graph." },
  { name: "submit_finding", description: "Records a potential finding with its evidence and impact." },
  {
    name: "validate_finding",
    description: "Sends one fixed safe GET probe to a scoped endpoint and records the result.",
    approval: "manual",
  },
  { name: "finish_intent", description: "Completes the assigned worker intent." },
];

const MAIN_AGENT_TOOLS: ToolInfo[] = [
  ...SHARED_EXECUTION_TOOLS,
  { name: "get_graph_overview", description: "Reads task graph counts, open intents, facts, findings and goal." },
  { name: "get_coverage", description: "Lists in-scope assets and whether they have graph evidence." },
  { name: "list_findings", description: "Lists findings recorded for this task." },
  { name: "list_recent_activity", description: "Reads recent planner and worker activity." },
  { name: "send_intent", description: "Creates an intent on behalf of the operator." },
];

const AGENT_ROLES = [
  { name: "Planner", purpose: "Maintains the phased plan, dispatches parallel specialists, reviews evidence, and replans.", tools: PLANNER_TOOLS },
  { name: "Worker", purpose: "Executes one assigned intent and records evidence.", tools: WORKER_TOOLS },
  { name: "Main Agent", purpose: "Answers operator questions about this task and can send intents.", tools: MAIN_AGENT_TOOLS },
];

export function AgentToolsPanel() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
        <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Shell commands and Python scripts run without per-run approval and are not sandboxed. They
          run with the application user's OS permissions. Use them for reconnaissance only within
          the explicitly authorized task scope. Vulnerability validation still requires manual approval.
        </span>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {AGENT_ROLES.map((role) => (
          <Card key={role.name} title={role.name} icon="bot" subtitle={role.purpose}>
            <ul className="space-y-2">
              {role.tools.map((entry) => (
                <li key={entry.name} className="rounded-lg border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mono text-[11px] text-ink">{entry.name}</span>
                    {entry.approval === "manual" && <Badge tone="awaiting_approval">manual approval</Badge>}
                    {entry.approval === "none" && <Badge tone="pending">no per-run approval</Badge>}
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">{entry.description}</p>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <p className="text-[11px] text-faint">
        Simulated reconnaissance tools are disabled. Use shell and Python tools for live reconnaissance
        within the authorized scope; these tools are unrestricted and not sandboxed.
      </p>
    </div>
  );
}
