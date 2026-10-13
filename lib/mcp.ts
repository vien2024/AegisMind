import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { db, now, parseJson } from "./db";

export type McpTransport = "streamable-http" | "sse";
export type McpAgentTarget = "planner" | "subagent";

export interface McpToolDescriptor {
    name: string;
    description?: string;
    inputSchema: Record<string, unknown>;
}

export interface McpServerRecord {
    id: number;
    name: string;
    endpoint: string;
    transport: McpTransport;
    agent_target: McpAgentTarget | null;
    bearer_token: string | null;
    tools: McpToolDescriptor[];
    last_connected_at: string | null;
    created_at: string;
    updated_at: string;
}

function serverRecord(row: Record<string, unknown>): McpServerRecord {
    return {
        ...(row as unknown as Omit<McpServerRecord, "tools">),
        tools: parseJson(String(row.tools ?? "[]"), [] as McpToolDescriptor[]),
    };
}

export async function listMcpServers(): Promise<McpServerRecord[]> {
    const rows = await db().prepare("SELECT * FROM mcp_servers ORDER BY name").all();
    return rows.map(serverRecord);
}

export async function getMcpServer(id: number): Promise<McpServerRecord | null> {
    const row = await db().prepare("SELECT * FROM mcp_servers WHERE id = $1").get(id);
    return row ? serverRecord(row) : null;
}

export async function createMcpServer(input: {
    name: string;
    endpoint: string;
    transport: McpTransport;
    agentTarget: McpAgentTarget;
    bearerToken?: string;
}): Promise<McpServerRecord> {
    const timestamp = now();
    const result = await db()
        .prepare(
            `INSERT INTO mcp_servers (name, endpoint, transport, agent_target, bearer_token, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
        )
        .run(input.name, input.endpoint, input.transport, input.agentTarget, input.bearerToken || null, timestamp);
    const server = await getMcpServer(result.lastInsertRowid);
    if (!server) throw new Error("MCP server was not saved");
    return server;
}

export async function updateMcpServerAgentTarget(
    id: number,
    agentTarget: McpAgentTarget | null,
): Promise<boolean> {
    const result = await db()
        .prepare("UPDATE mcp_servers SET agent_target = $1, updated_at = $2 WHERE id = $3")
        .run(agentTarget, now(), id);
    return result.rowsAffected > 0;
}

export async function deleteMcpServer(id: number): Promise<boolean> {
    const result = await db().prepare("DELETE FROM mcp_servers WHERE id = $1").run(id);
    return result.rowsAffected > 0;
}

export async function saveMcpTools(
    id: number,
    tools: McpToolDescriptor[],
): Promise<void> {
    await db()
        .prepare(
            "UPDATE mcp_servers SET tools = $1, last_connected_at = $2, updated_at = $2 WHERE id = $3",
        )
        .run(JSON.stringify(tools), now(), id);
}

async function withMcpClient<T>(
    server: McpServerRecord,
    action: (client: Client) => Promise<T>,
): Promise<T> {
    const client = new Client({ name: "aegismind", version: "0.1.0" });
    const headers = new Headers();
    if (server.bearer_token) headers.set("authorization", `Bearer ${server.bearer_token}`);

    const transport =
        server.transport === "sse"
            ? new SSEClientTransport(new URL(server.endpoint), {
                requestInit: { headers },
                eventSourceInit: {
                    fetch: (url, init) => {
                        const eventHeaders = new Headers(init.headers);
                        if (server.bearer_token) {
                            eventHeaders.set("authorization", `Bearer ${server.bearer_token}`);
                        }
                        return fetch(url, { ...init, headers: eventHeaders });
                    },
                },
            })
            : new StreamableHTTPClientTransport(new URL(server.endpoint), {
                requestInit: { headers },
            });

    try {
        await client.connect(transport, { timeout: 15_000 });
        return await action(client);
    } finally {
        await client.close().catch(() => { });
    }
}

export async function discoverMcpTools(server: McpServerRecord): Promise<McpToolDescriptor[]> {
    return withMcpClient(server, async (client) => {
        const result = await client.listTools({}, { timeout: 15_000 });
        return result.tools.map((tool) => ({
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema: tool.inputSchema,
        }));
    });
}

export async function callMcpTool(
    server: McpServerRecord,
    name: string,
    args: Record<string, unknown>,
) {
    return withMcpClient(server, async (client) => {
        const { tools } = await client.listTools({}, { timeout: 15_000 });
        if (!tools.some((tool) => tool.name === name)) {
            throw new Error("That tool is not currently offered by this MCP server");
        }
        return client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
    });
}