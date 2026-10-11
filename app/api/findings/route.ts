import { unauthorized, badRequest } from "@/lib/api";
import * as repo from "@/lib/repo";
import { SEVERITIES, type Severity } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const taskId = new URL(request.url).searchParams.get("taskId");
  const findings = repo.listFindings(taskId ? Number(taskId) : undefined);
  const tasks = repo.listTasks();
  return Response.json({
    findings: findings.map((f) => ({
      ...f,
      task_name: tasks.find((t) => t.id === f.task_id)?.name ?? null,
      asset_value: f.asset_id ? repo.getAsset(f.asset_id)?.value ?? null : null,
    })),
  });
}

export async function POST(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as {
    taskId?: number;
    title?: string;
    severity?: string;
    description?: string;
    evidence?: string;
  };
  if (!body.title?.trim()) return badRequest("title is required");
  const severity: Severity = SEVERITIES.includes(body.severity as Severity)
    ? (body.severity as Severity)
    : "info";
  const finding = repo.createFinding({
    taskId: body.taskId ?? null,
    assetId: null,
    nodeId: null,
    title: body.title.trim(),
    severity,
    description: body.description,
    evidence: body.evidence,
  });
  return Response.json({ finding }, { status: 201 });
}
