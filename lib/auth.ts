import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db, now } from "./db";

export const SESSION_COOKIE = "aegismind_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password: string, salt: string, hash: string): boolean {
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export async function hasAdmin(): Promise<boolean> {
  const row = await db()
    .prepare("SELECT COUNT(*) as n FROM users")
    .get() as { n: number } | null;
  return Boolean(row && row.n > 0);
}

export async function createAdmin(username: string, password: string): Promise<number> {
  const { salt, hash } = hashPassword(password);
  const info = await db()
    .prepare(
      "INSERT INTO users (username, password_hash, salt, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
    )
    .run(username, hash, salt, now());
  return info.lastInsertRowid;
}

export async function authenticate(
  username: string,
  password: string,
): Promise<number | null> {
  const user = await db()
    .prepare("SELECT id, password_hash, salt FROM users WHERE username = $1")
    .get(username) as
    | { id: number; password_hash: string; salt: string }
    | null;
  if (!user) return null;
  return verifyPassword(password, user.salt, user.password_hash) ? user.id : null;
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db()
    .prepare(
      "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
    )
    .run(token, userId, now(), expiresAt);
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await db().prepare("DELETE FROM sessions WHERE token = $1").run(token);
}

export async function sessionUser(
  token: string | undefined,
): Promise<{ id: number; username: string } | null> {
  if (!token) return null;
  const row = await db()
    .prepare(
      `SELECT u.id as id, u.username as username, s.expires_at as expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = $1`,
    )
    .get(token) as
    | { id: number; username: string; expires_at: string }
    | null;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await destroySession(token);
    return null;
  }
  return { id: row.id, username: row.username };
}

export async function currentUser() {
  const store = await cookies();
  return sessionUser(store.get(SESSION_COOKIE)?.value);
}

export async function requireApiUser() {
  const user = await currentUser();
  if (!user) {
    return {
      user: null,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as const;
  }
  return { user, response: null } as const;
}
