import { currentUser } from "./auth";

export async function unauthorized(): Promise<Response | null> {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}

export function badRequest(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}
