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

  const format = new URL(request.url).searchParams.get("format") ?? "md";

  if (format === "json") {
    return Response.json({ task, findings, nodes, edges, activity });
  }

  if (format === "csv") {
    const header = "id,severity,status,title,asset_id,disposition";
    const rows = findings.map((f) =>
      [f.id, f.severity, f.status, JSON.stringify(f.title), f.asset_id ?? "", f.disposition ?? ""].join(","),
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
    `- Language: ${task.language}`,
    "",
    "## Findings",
    "",
    ...[...findings]
      .sort((a, b) => a.severity.localeCompare(b.severity))
      .map((f) => [`### [${f.severity.toUpperCase()}] ${f.title}`, "", f.description ?? "", "", `Evidence: ${f.evidence ?? "-"}`, ""])
      .flat(),
    "## Exploration graph",
    "",
    `- Nodes: ${nodes.length}`,
    `- Edges: ${edges.length}`,
    ...["goal", "intent", "fact", "finding", "hint"].map((kind) => `- ${kind}: ${nodes.filter((n) => n.kind === kind).length}`),
    "",
    "> All activity in this edition is produced by a local, offline simulator. Nothing in this report corresponds to a live target.",
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="task-${id}-report.md"`,
    },
  });
}
