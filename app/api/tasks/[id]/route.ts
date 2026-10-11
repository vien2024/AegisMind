import { unauthorized, badRequest } from "@/lib/api";
import * as repo from "@/lib/repo";
import { taskGraph } from "@/lib/task-service";
import type { Language } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const denied = await unauthorized();
  if (denied) return denied;
  const id = Number((await params).id);
  const task = await repo.getTask(id);
  if (!task) return Response.json({ error: "not found" }, { status: 404 });
  const graph = await taskGraph(id);
  return Response.json({
    task,
    counts: await repo.nodeKindCounts(id),
    nodes: graph.nodes,
    edges: graph.edges,
    anchors: graph.anchors,
    findings: await repo.listFindings(id),
    coverage: (await import("@/lib/task-service")).coverageReport(id),
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const denied = await unauthorized();
  if (denied) return denied;
  const id = Number((await params).id);
  const task = await repo.getTask(id);
  if (!task) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    goal?: string;
    language?: Language;
    concurrency?: number;
    autoApprove?: boolean;
  };
  if (body.concurrency !== undefined && (body.concurrency < 1 || body.concurrency > 10)) {
    return badRequest("concurrency must be between 1 and 10");
  }
  await repo.updateTask(id, {
    name: body.name,
    description: body.description,
    goal: body.goal,
    language: body.language,
    concurrency: body.concurrency,
    auto_approve: body.autoApprove === undefined ? undefined : body.autoApprove ? 1 : 0,
  });
  return Response.json({ task: await repo.getTask(id) });
}

export async function DELETE(_request: Request, { params }: Params) {
  const denied = await unauthorized();
  if (denied) return denied;
  const id = Number((await params).id);
  if (!await repo.getTask(id)) return Response.json({ error: "not found" }, { status: 404 });
  await repo.deleteTask(id);
  return Response.json({ ok: true });
}
