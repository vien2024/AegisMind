import { randomBytes, scryptSync } from "node:crypto";
import { db, now } from "../lib/db";

/**
 * Reset (or create) the local administrator password.
 *   npm run reset-password -- admin newpassword
 */
const [, , username, password] = process.argv;
if (!username || !password || password.length < 6) {
  console.error("Usage: npm run reset-password -- <username> <password>   (password min 6 chars)");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");
const database = db();
database.prepare("DELETE FROM sessions").run();

const existing = database.prepare("SELECT id FROM users WHERE username = ?").get(username) as
  | { id: number }
  | undefined;

if (existing) {
  database.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?").run(hash, salt, existing.id);
  console.log(`Password updated for "${username}".`);
} else {
  database.prepare("INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)").run(username, hash, salt, now());
  console.log(`Created administrator "${username}".`);
}
console.log("All existing sessions were invalidated.");
