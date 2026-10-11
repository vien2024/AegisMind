import { unauthorized, badRequest } from "@/lib/api";
import { resumeTask } from "@/lib/engine";
import { emitEvent } from "@/lib/events";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const taskId = new URL(request.url).searchParams.get("taskId");
  return Response.json({ approvals: repo.listApprovals(taskId ? Number(taskId) : undefined) });
}

export async function POST(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { id?: number; decision?: string };
  if (!body.id || !["approved", "denied"].includes(body.decision ?? "")) {
    return badRequest("id and decision (approved|denied) are required");
  }
  repo.setApprovalStatus(body.id, body.decision!);
  const approval = repo.listApprovals().find((a) => a.id === body.id);
  if (approval?.task_id) {
    emitEvent({ type: "approval", taskId: approval.task_id, payload: { approvalId: approval.id, status: body.decision } });
    // A decision unblocks the task: bring it back up so the engine can re-claim the intent.
    const task = repo.getTask(approval.task_id);
    if (task && task.status === "paused") resumeTask(task.id);
  }
  return Response.json({ approval });
}
