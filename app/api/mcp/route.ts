import { unauthorized, badRequest } from "@/lib/api";
import { createMcpServer, listMcpServers, type McpAgentTarget, type McpServerRecord, type McpTransport } from "@/lib/mcp";

export const dynamic = "force-dynamic";

function publicServer(server: McpServerRecord) {
    const { bearer_token, ...safe } = server;
    return { ...safe, hasBearerToken: Boolean(bearer_token) };
}

export async function GET() {
    const denied = await unauthorized();
    if (denied) return denied;
    return Response.json({ servers: (await listMcpServers()).map(publicServer) });
}

export async function POST(request: Request) {
    const denied = await unauthorized();
    if (denied) return denied;

    const body = (await request.json().catch(() => ({}))) as {
        name?: string;
        endpoint?: string;
        transport?: string;
        agentTarget?: string;
        bearerToken?: string;
    };
    const name = body.name?.trim();
    if (!name || name.length > 80) return badRequest("name must be between 1 and 80 characters");
    if (!body.endpoint || body.endpoint.length > 2048) return badRequest("a valid MCP endpoint is required");

    let endpoint: URL;
    try {
        endpoint = new URL(body.endpoint);
    } catch {
        return badRequest("endpoint must be a valid URL");
    }
    if (!(["http:", "https:"].includes(endpoint.protocol)) || endpoint.username || endpoint.password) {
        return badRequest("endpoint must use HTTP or HTTPS and must not include URL credentials");
    }
    if (endpoint.search || endpoint.hash) {
        return badRequest("put authentication in the bearer token field, not in the endpoint URL");
    }

    const transport = body.transport ?? "streamable-http";
    if (transport !== "streamable-http" && transport !== "sse") {
        return badRequest("transport must be streamable-http or sse");
    }
    if (body.agentTarget !== "planner" && body.agentTarget !== "subagent") {
        return badRequest("agentTarget must be planner or subagent");
    }
    const bearerToken = body.bearerToken?.trim();
    if (bearerToken && bearerToken.length > 4096) return badRequest("bearer token is too long");
    if (bearerToken && endpoint.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) {
        return badRequest("use HTTPS when sending a bearer token to a non-local server");
    }

    try {
        const server = await createMcpServer({
            name,
            endpoint: endpoint.toString(),
            transport: transport as McpTransport,
            agentTarget: body.agentTarget as McpAgentTarget,
            bearerToken,
        });
        return Response.json({ server: publicServer(server) }, { status: 201 });
    } catch (error) {
        if ((error as { code?: string }).code === "23505") {
            return Response.json({ error: "a server with that name already exists" }, { status: 409 });
        }
        return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
        );
    }
}