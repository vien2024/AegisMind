import { authenticate, createSession } from "@/lib/auth";
import { isSecureRequest, sessionCookie } from "@/lib/session-cookie";
import { seedDemoData } from "@/lib/seed";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  const userId = authenticate(body.username ?? "", body.password ?? "");
  if (!userId) return Response.json({ error: "Invalid credentials" }, { status: 401 });
  seedDemoData();
  const session = createSession(userId);
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", sessionCookie(session.token, session.expiresAt, isSecureRequest(request)));
  return response;
}
