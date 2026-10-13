import { unauthorized } from "@/lib/api";
import * as repo from "@/lib/repo";
import { createTaskFromInput } from "@/lib/task-service";
import type { Language } from "@/lib/types";

export async function GET() {
  const denied = await unauthorized();
  if (denied) return denied;
  const tasks = await repo.listTasks();
  const tasksWithCounts = await Promise.all(
    tasks.map(
      async (task) => ({
        ...task,
        counts: await repo.nodeKindCounts(task.id),
        findings: (await repo.listFindings(task.id)).length,
      }),
    ),
  );
  return Response.json({ tasks: tasksWithCounts });
}

export async function POST(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    target?: string;
    description?: string;
    goal?: string;
    language?: Language;
    concurrency?: number;
    timeLimitMinutes?: number | null;
    autoApprove?: boolean;
  };
  if (!body.target?.trim()) return Response.json({ error: "target is required" }, { status: 400 });
  if (
    body.timeLimitMinutes !== undefined &&
    body.timeLimitMinutes !== null &&
    (!Number.isInteger(body.timeLimitMinutes) || body.timeLimitMinutes < 1 || body.timeLimitMinutes > 1440)
  ) {
    return Response.json({ error: "timeLimitMinutes must be between 1 and 1440, or null for no limit" }, { status: 400 });
  }
  const task = await createTaskFromInput({
    name: body.name?.trim() || `Task against ${body.target.trim()}`,
    target: body.target.trim(),
    description: body.description,
    goal: body.goal,
    language: body.language,
    concurrency: body.concurrency,
    timeLimitMinutes: body.timeLimitMinutes,
    autoApprove: body.autoApprove,
  });
  return Response.json({ task }, { status: 201 });
}
