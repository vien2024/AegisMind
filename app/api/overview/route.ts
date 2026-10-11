import { unauthorized } from "@/lib/api";
import { buildOverview } from "@/lib/overview";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await unauthorized();
  if (denied) return denied;
  return Response.json(buildOverview());
}
