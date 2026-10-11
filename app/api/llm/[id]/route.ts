import { unauthorized, badRequest } from "@/lib/api";
import * as repo from "@/lib/repo";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const denied = await unauthorized();
  if (denied) return denied;
  const id = Number((await params).id);
  if (!repo.getLlmConfig(id)) return badRequest("not found", 404);
  const body = (await request.json().catch(() => ({}))) as { activate?: boolean };
  if (body.activate) repo.setActiveLlmConfig(id);
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const denied = await unauthorized();
  if (denied) return denied;
  const id = Number((await params).id);
  if (!repo.getLlmConfig(id)) return badRequest("not found", 404);
  repo.deleteLlmConfig(id);
  return Response.json({ ok: true });
}
