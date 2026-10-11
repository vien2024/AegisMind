import { unauthorized } from "@/lib/api";
import * as repo from "@/lib/repo";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const denied = await unauthorized();
  if (denied) return denied;
  const id = Number((await params).id);
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "200");
  return Response.json({ activity: repo.listActivity(id, Math.min(Math.max(limit, 1), 1000)) });
}
