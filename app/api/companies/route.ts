import { unauthorized, badRequest } from "@/lib/api";
import * as repo from "@/lib/repo";

export async function GET() {
  const denied = await unauthorized();
  if (denied) return denied;
  return Response.json({ companies: repo.listCompanies() });
}

export async function POST(request: Request) {
  const denied = await unauthorized();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { name?: string; description?: string };
  if (!body.name?.trim()) return badRequest("name is required");
  return Response.json({ company: repo.createCompany(body.name.trim(), body.description) }, { status: 201 });
}
