import { unauthorized, badRequest } from "@/lib/api";
import * as repo from "@/lib/repo";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const denied = await unauthorized();
  if (denied) return denied;
  const id = Number((await params).id);
  const config = await repo.getLlmConfig(id);
  if (!config) return badRequest("not found", 404);
  const body = (await request.json().catch(() => ({}))) as { activate?: boolean };
  if (body.activate && config.provider === "mock") {
    return badRequest("The offline simulator is disabled for agent tasks. Activate a live model provider.");
  }
  if (body.activate) await repo.setActiveLlmConfig(id);
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const denied = await unauthorized();
  if (denied) return denied;
  const id = Number((await params).id);
  if (!(await repo.getLlmConfig(id))) return badRequest("not found", 404);
  await repo.deleteLlmConfig(id);
  return Response.json({ ok: true });
}
