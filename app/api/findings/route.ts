import { unauthorized, badRequest } from "@/lib/api";
import * as repo from "@/lib/repo";
import { SEVERITIES, type Severity } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const taskId = new URL(request.url).searchParams.get("taskId");
  const findings = await repo.listFindings(taskId ? Number(taskId) : undefined);
  const tasks = await repo.listTasks();

  const enriched = await Promise.all(
    findings.map(async (f) => ({
      ...f,
      task_name: tasks.find((t) => t.id === f.task_id)?.name ?? null,
      asset_value: f.asset_id ? (await repo.getAsset(f.asset_id))?.value ?? null : null,
    })),
  );

  return Response.json({ findings: enriched });
}

export async function POST(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as {
    taskId?: number;
    title?: string;
    severity?: string;
    description?: string;
    reproduction?: string;
    location?: string;
    impact?: string;
    evidence?: string;
    observed_payload?: string;
    observed_result?: string;
  };
  if (!body.title?.trim()) return badRequest("title is required");
  const requiredDetails = ["description", "reproduction", "location", "impact", "evidence"] as const;
  for (const field of requiredDetails) {
    if (typeof body[field] !== "string" || !body[field].trim()) {
      return badRequest(`${field} is required and cannot be empty`);
    }
    if (body.observed_payload !== undefined &&
        (typeof body.observed_payload !== "string" || body.observed_payload.length > 4096)) {
      return badRequest("observed_payload must be a string of at most 4,096 characters");
    }
    if (body.observed_result !== undefined &&
        (typeof body.observed_result !== "string" || body.observed_result.length > 8192)) {
      return badRequest("observed_result must be a string of at most 8,192 characters");
    }
  }
  const severity: Severity =
    SEVERITIES.includes(body.severity as Severity)
      ? (body.severity as Severity)
      : "info";
  const finding = await repo.createFinding({
    taskId: body.taskId ?? null,
    assetId: null,
    nodeId: null,
    title: body.title.trim(),
    severity,
    description: body.description!.trim(),
    reproduction: body.reproduction!.trim(),
    location: body.location!.trim(),
    impact: body.impact!.trim(),
    evidence: body.evidence!.trim(),
    observedPayload: body.observed_payload,
    observedResult: body.observed_result,
  });
  return Response.json({ finding }, { status: 201 });
}
