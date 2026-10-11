import { currentUser, hasAdmin } from "@/lib/auth";

export async function GET() {
  const user = await currentUser();
  return Response.json({ hasAdmin: hasAdmin(), authenticated: Boolean(user), user });
}
