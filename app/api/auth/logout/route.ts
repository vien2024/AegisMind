import { cookies } from "next/headers";
import { destroySession, SESSION_COOKIE } from "@/lib/auth";
import { clearedSessionCookie, isSecureRequest } from "@/lib/session-cookie";

export async function POST(request: Request) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  const response = Response.json({ ok: true });
  response.headers.append("Set-Cookie", clearedSessionCookie(isSecureRequest(request)));
  return response;
}
