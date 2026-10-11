import { unauthorized } from "@/lib/api";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId");
  const limit = Number(url.searchParams.get("limit") ?? "200");
  return Response.json({ traffic: repo.listTraffic(taskId ? Number(taskId) : undefined, Math.min(limit, 1000)) });
}
