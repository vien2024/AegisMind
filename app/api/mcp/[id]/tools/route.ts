import { unauthorized } from "@/lib/api";
import { callMcpTool, getMcpServer } from "@/lib/mcp";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
    const denied = await unauthorized();
    if (denied) return denied;
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id < 1) {
        return Response.json({ error: "invalid server id" }, { status: 400 });
    }
    const server = await getMcpServer(id);
    if (!server) return Response.json({ error: "server not found" }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        arguments?: unknown;
    };
    if (!body.name?.trim()) return Response.json({ error: "tool name is required" }, { status: 400 });
    if (!body.arguments || typeof body.arguments !== "object" || Array.isArray(body.arguments)) {
        return Response.json({ error: "tool arguments must be a JSON object" }, { status: 400 });
    }

    try {
        const result = await callMcpTool(server, body.name, body.arguments as Record<string, unknown>);
        return Response.json({ result });
    } catch (error) {
        return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 502 },
        );
    }
}