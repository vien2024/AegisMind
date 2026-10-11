import { redirect } from "next/navigation";
import { currentUser, hasAdmin } from "./auth";

export async function requirePageUser() {
  if (!hasAdmin()) redirect("/setup");
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function pageAuthState() {
  const user = await currentUser();
  return { hasAdmin: hasAdmin(), user };
}
