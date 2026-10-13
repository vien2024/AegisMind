import { unauthorized } from "@/lib/api";
import * as repo from "@/lib/repo";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const denied = await unauthorized();
  if (denied) return denied;
  const id = Number((await params).id);
  const task = await repo.getTask(id);
  if (!task) return Response.json({ error: "not found" }, { status: 404 });

  const findings = await repo.listFindings(id);
  const nodes = await repo.listNodes(id, undefined, 2000);
  const edges = await repo.listEdges(id);
  const activity = await repo.listActivity(id, 1000);
  const timeLimitReached = activity.some((entry) => entry.title === "task time limit reached");

  const format = new URL(request.url).searchParams.get("format") ?? "md";

  if (format === "json") {
    return Response.json({ task, findings, nodes, edges, activity });
  }

  if (format === "csv") {
    const header = "id,severity,status,title,description,reproduction,location,impact,evidence,validator_type,validator_status,validator_result,asset_id,disposition";
    const rows = findings.map((f) =>
      [
        f.id,
        f.severity,
        f.status,
        f.title,
        f.description,
        f.reproduction,
        f.location,
        f.impact,
        f.evidence,
        f.validator_type ?? "",
        f.validator_status,
        f.validator_result ?? "",
        f.asset_id ?? "",
        f.disposition ?? "",
      ].map((value) => JSON.stringify(value ?? "")).join(","),
    );
    return new Response([header, ...rows].join("\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="task-${id}-findings.csv"`,
      },
    });
  }

  const lines = [
    `# AegisMind report — ${task.name}`,
    "",
    `- Target: ${task.target}`,
    `- Status: ${task.status}`,
    `- Created: ${task.created_at}`,
    `- Time limit: ${task.time_limit_minutes ? `${task.time_limit_minutes} minutes` : "none"}`,
    `- Time limit reached: ${timeLimitReached ? "yes" : "no"}`,
    `- Finished: ${task.finished_at ?? "not finished"}`,
    `- Language: ${task.language}`,
    "",
    "## Findings",
    "",
    ...[...findings]
      .sort((a, b) => a.severity.localeCompare(b.severity))
      .map((f) => [
        `### [${f.severity.toUpperCase()}] ${f.title}`,
        "",
        `Description: ${f.description ?? "-"}`,
        `Reproduction: ${f.reproduction ?? "-"}`,
        `Location: ${f.location ?? "-"}`,
        `Impact: ${f.impact ?? "-"}`,
        `Evidence: ${f.evidence ?? "-"}`,
        `Validation: ${f.validator_status}${f.validator_type ? ` (${f.validator_type}, parameter: ${f.validator_parameter ?? "-"})` : ""}`,
        `Validation result: ${f.validator_result ?? "No validator result recorded."}`,
        "",
      ])
      .flat(),
    "## Exploration graph",
    "",
    `- Nodes: ${nodes.length}`,
    `- Edges: ${edges.length}`,
    ...["goal", "intent", "fact", "finding", "hint"].map((kind) => `- ${kind}: ${nodes.filter((n) => n.kind === kind).length}`),
    "",
    "> Simulated legacy records, if present, are not live evidence. Current task agents do not expose simulated reconnaissance; shell/Python reconnaissance runs with application-user permissions, while validator probes require separate operator approval.",
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="task-${id}-report.md"`,
    },
  });
}
