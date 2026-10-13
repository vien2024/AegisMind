import { unauthorized, badRequest } from "@/lib/api";
import { pauseTask, resetTask, resumeTask, startTask, stopTask } from "@/lib/engine";
import * as repo from "@/lib/repo";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const denied = await unauthorized();
  if (denied) return denied;
  const id = Number((await params).id);
  if (!(await repo.getTask(id))) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { action?: string };

  switch (body.action) {
    case "start": {
      const result = await startTask(id);
      return Response.json({ ok: result.started, ...result }, { status: result.started ? 200 : 409 });
    }
    case "pause":
      pauseTask(id);
      return Response.json({ ok: true });
    case "resume": {
      const result = await resumeTask(id);
      return Response.json({ ok: result.started, ...result }, { status: result.started ? 200 : 409 });
    }
    case "stop":
      stopTask(id);
      return Response.json({ ok: true });
    case "reset":
      resetTask(id);
      return Response.json({ ok: true });
    default:
      return badRequest(`unknown action: ${body.action ?? "(none)"}`);
  }
}
