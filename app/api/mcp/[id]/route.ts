import { unauthorized } from "@/lib/api";
import { deleteMcpServer, getMcpServer, updateMcpServerAgentTarget, type McpAgentTarget } from "@/lib/mcp";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
    const denied = await unauthorized();
    if (denied) return denied;
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id < 1) {
        return Response.json({ error: "invalid server id" }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as { agentTarget?: unknown };
    if (body.agentTarget !== null && body.agentTarget !== "planner" && body.agentTarget !== "subagent") {
        return Response.json({ error: "agentTarget must be planner, subagent, or null" }, { status: 400 });
    }
    if (!(await updateMcpServerAgentTarget(id, body.agentTarget as McpAgentTarget | null))) {
        return Response.json({ error: "server not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
    const denied = await unauthorized();
    if (denied) return denied;
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id < 1) {
        return Response.json({ error: "invalid server id" }, { status: 400 });
    }
    if (!(await getMcpServer(id))) return Response.json({ error: "server not found" }, { status: 404 });
    await deleteMcpServer(id);
    return Response.json({ ok: true });
}