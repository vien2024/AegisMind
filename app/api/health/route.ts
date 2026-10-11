import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Unauthenticated liveness probe for Docker / load-balancer health checks.
 * It only proves the process is up and the SQLite database is reachable.
 */
export async function GET() {
  try {
    db().prepare("SELECT 1").get();
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, app: "AegisMind", time: new Date().toISOString() });
}
