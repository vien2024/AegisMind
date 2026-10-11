import { unauthorized } from "@/lib/api";
import * as repo from "@/lib/repo";
import type { Finding } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const denied = await unauthorized();
  if (denied) return denied;
  const id = Number((await params).id);
  if (!repo.getFinding(id)) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Partial<Finding>;
  repo.updateFinding(id, {
    status: body.status,
    disposition: body.disposition,
    severity: body.severity,
    fix_version: body.fix_version,
    description: body.description,
    evidence: body.evidence,
  });
  return Response.json({ finding: repo.getFinding(id) });
}
