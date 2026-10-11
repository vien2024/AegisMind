import { badRequest } from "@/lib/api";
import { createAdmin, createSession, hasAdmin } from "@/lib/auth";
import { isSecureRequest, sessionCookie } from "@/lib/session-cookie";
import { seedDemoData } from "@/lib/seed";

export async function POST(request: Request) {
  if (hasAdmin()) return badRequest("Administrator already configured", 409);
  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = (body.username ?? "admin").trim() || "admin";
  const password = body.password ?? "";
  if (password.length < 6) return badRequest("Password must be at least 6 characters");

  const userId = createAdmin(username, password);
  seedDemoData();
  const session = createSession(userId);
  const response = Response.json({ ok: true, username });
  response.headers.append("Set-Cookie", sessionCookie(session.token, session.expiresAt, isSecureRequest(request)));
  return response;
}
