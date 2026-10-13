import { unauthorized } from "@/lib/api";
import { discoverMcpTools, getMcpServer, saveMcpTools } from "@/lib/mcp";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
    const denied = await unauthorized();
    if (denied) return denied;
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id < 1) {
        return Response.json({ error: "invalid server id" }, { status: 400 });
    }
    const server = await getMcpServer(id);
    if (!server) return Response.json({ error: "server not found" }, { status: 404 });

    try {
        const tools = await discoverMcpTools(server);
        await saveMcpTools(id, tools);
        return Response.json({ tools, lastConnectedAt: new Date().toISOString() });
    } catch (error) {
        return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 502 },
        );
    }
}