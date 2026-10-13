import { badRequest, unauthorized } from "@/lib/api";
import * as repo from "@/lib/repo";
import type { Finding } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const denied = await unauthorized();
  if (denied) return denied;
  const id = Number((await params).id);
  const finding = await repo.getFinding(id);
  if (!finding) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Partial<Finding>;
  if (body.status === "confirmed" && finding.validator_status !== "confirmed") {
    return badRequest("A finding can only be confirmed after validator evidence confirms it.");
  }
  const requiredDetails = ["description", "reproduction", "location", "impact", "evidence"] as const;
  for (const field of requiredDetails) {
    const value = body[field];
    if (value !== undefined && (typeof value !== "string" || !value.trim())) {
      return badRequest(`${field} cannot be empty`);
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
  await repo.updateFinding(id, {
    status: body.status,
    disposition: body.disposition,
    severity: body.severity,
    fix_version: body.fix_version,
    description: body.description,
    reproduction: body.reproduction,
    location: body.location,
    impact: body.impact,
    evidence: body.evidence,
    observed_payload: body.observed_payload,
    observed_result: body.observed_result,
  });
  return Response.json({ finding: await repo.getFinding(id) });
}
