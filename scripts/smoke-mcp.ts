import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { callMcpTool, discoverMcpTools, type McpServerRecord } from "../lib/mcp";

const httpServer = createServer(async (request, response) => {
    const server = new McpServer({ name: "aegismind-smoke", version: "1.0.0" });
    server.registerTool(
        "echo_target",
        {
            description: "Echo a target for MCP transport testing.",
            inputSchema: { target: z.string() },
        },
        async ({ target }) => ({ content: [{ type: "text", text: `received ${target}` }] }),
    );

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
        await server.connect(transport);
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
        await transport.handleRequest(request, response, body);
    } catch (error) {
        if (!response.headersSent) response.writeHead(500);
        response.end(error instanceof Error ? error.message : String(error));
    } finally {
        await server.close().catch(() => { });
    }
});

async function main() {
    httpServer.listen(0, "127.0.0.1");
    await once(httpServer, "listening");
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");

    const server: McpServerRecord = {
        id: 1,
        name: "Smoke MCP",
        endpoint: `http://127.0.0.1:${address.port}/mcp`,
        transport: "streamable-http",
        agent_target: null,
        bearer_token: null,
        tools: [],
        last_connected_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    try {
        const tools = await discoverMcpTools(server);
        assert.equal(tools.length, 1);
        assert.equal(tools[0]?.name, "echo_target");

        const result = await callMcpTool(server, "echo_target", { target: "authorized-test-host" });
        assert.equal(result.isError, undefined);
        const content = result.content as Array<{ text?: string }>;
        assert.equal(content[0]?.text, "received authorized-test-host");
        console.log("MCP HTTP SMOKE OK");
    } finally {
        await new Promise<void>((resolve, reject) => {
            httpServer.close((error) => error ? reject(error) : resolve());
        });
    }
}

main().catch((error) => {
    console.error("MCP HTTP SMOKE FAILED:", error);
    process.exitCode = 1;
});