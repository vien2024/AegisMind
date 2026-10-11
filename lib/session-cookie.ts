import { SESSION_COOKIE } from "./auth";

/** True when the request reached us over TLS (directly or through the preview proxy). */
export function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]!.trim().toLowerCase() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Session cookie attributes.
 *
 * Over HTTPS the preview panel serves the app inside a cross-site frame, where a plain
 * `SameSite=Lax` cookie is third-party and gets dropped — so we use
 * `SameSite=None; Secure; Partitioned` (CHIPS), which browsers persist per top-level site.
 * Over plain HTTP (local `next dev`) `Secure` cookies are rejected, so we stay on `Lax`.
 */
export function sessionCookie(token: string, expiresAt: string, secure: boolean): string {
  const base = `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Expires=${new Date(expiresAt).toUTCString()}`;
  return secure ? `${base}; SameSite=None; Secure; Partitioned` : `${base}; SameSite=Lax`;
}

export function clearedSessionCookie(secure: boolean): string {
  const base = `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`;
  return secure ? `${base}; SameSite=None; Secure; Partitioned` : `${base}; SameSite=Lax`;
}
