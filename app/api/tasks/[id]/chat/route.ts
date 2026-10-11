import { createAgentUIStreamResponse } from "ai";
import { unauthorized, badRequest } from "@/lib/api";
import { buildMainAgent } from "@/lib/main-agent";
import * as repo from "@/lib/repo";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const denied = await unauthorized();
  if (denied) return denied;
  const id = Number((await params).id);
  if (!repo.getTask(id)) return badRequest("task not found", 404);

  const { messages } = (await request.json().catch(() => ({}))) as { messages?: unknown[] };
  const agent = buildMainAgent(id);
  return createAgentUIStreamResponse({ agent, uiMessages: messages ?? [] });
}
