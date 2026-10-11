import { unauthorized } from "@/lib/api";
import * as repo from "@/lib/repo";
import { coverageReport, taskGraph } from "@/lib/task-service";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: Params) {
  const denied = await unauthorized();
  if (denied) return denied;
  const id = Number((await params).id);
  const task = repo.getTask(id);
  if (!task) return Response.json({ error: "not found" }, { status: 404 });
  const graph = taskGraph(id);
  return Response.json({
    task,
    counts: repo.nodeKindCounts(id),
    nodes: graph.nodes,
    edges: graph.edges,
    anchors: graph.anchors,
    coverage: coverageReport(id),
  });
}
