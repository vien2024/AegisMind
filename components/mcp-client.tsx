"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/shell/icons";
import { Badge, Empty, SectionHeading } from "@/components/ui";
import type { McpAgentTarget, McpToolDescriptor, McpTransport } from "@/lib/mcp";

export interface McpServerView {
    id: number;
    name: string;
    endpoint: string;
    transport: McpTransport;
    agent_target: McpAgentTarget | null;
    hasBearerToken: boolean;
    tools: McpToolDescriptor[];
    last_connected_at: string | null;
    created_at: string;
    updated_at: string;
}

interface McpResult {
    isError?: boolean;
    [key: string]: unknown;
}

export function McpClient({ initialServers }: { initialServers: McpServerView[] }) {
    const router = useRouter();
    const [servers, setServers] = useState(initialServers);
    const [selectedId, setSelectedId] = useState<number | null>(initialServers[0]?.id ?? null);
    const [showForm, setShowForm] = useState(initialServers.length === 0);
    const [form, setForm] = useState({ name: "", endpoint: "", transport: "streamable-http" as McpTransport, agentTarget: "planner" as McpAgentTarget, bearerToken: "" });
    const [selectedTool, setSelectedTool] = useState<string | null>(null);
    const [argumentsText, setArgumentsText] = useState("{}");
    const [result, setResult] = useState<McpResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirmRun, setConfirmRun] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);

    const selectedServer = servers.find((server) => server.id === selectedId) ?? null;
    const tool = selectedServer?.tools.find((entry) => entry.name === selectedTool) ?? null;

    function updateServer(id: number, patch: Partial<McpServerView>) {
        setServers((current) => current.map((server) => server.id === id ? { ...server, ...patch } : server));
    }

    async function addServer(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setBusy("save");
        setError(null);
        const response = await fetch("/api/mcp", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(form),
        });
        const payload = await response.json().catch(() => ({})) as { server?: McpServerView; error?: string };
        setBusy(null);
        if (!response.ok || !payload.server) {
            setError(payload.error ?? "Could not save MCP server");
            return;
        }
        setServers((current) => [...current, payload.server!]);
        setSelectedId(payload.server.id);
        setSelectedTool(null);
        setShowForm(false);
        setForm({ name: "", endpoint: "", transport: "streamable-http", agentTarget: "planner", bearerToken: "" });
        router.refresh();
    }

    async function updateAgentTarget(server: McpServerView, agentTarget: McpAgentTarget | null) {
        setBusy(`target-${server.id}`);
        setError(null);
        const response = await fetch(`/api/mcp/${server.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ agentTarget }),
        });
        const payload = await response.json().catch(() => ({})) as { error?: string };
        setBusy(null);
        if (!response.ok) {
            setError(payload.error ?? "Could not update MCP agent access");
            return;
        }
        updateServer(server.id, { agent_target: agentTarget });
        router.refresh();
    }

    async function connectServer(server: McpServerView) {
        setBusy(`connect-${server.id}`);
        setError(null);
        const response = await fetch(`/api/mcp/${server.id}/connect`, { method: "POST" });
        const payload = await response.json().catch(() => ({})) as {
            tools?: McpToolDescriptor[];
            lastConnectedAt?: string;
            error?: string;
        };
        setBusy(null);
        if (!response.ok || !payload.tools) {
            setError(payload.error ?? "Could not connect to MCP server");
            return;
        }
        updateServer(server.id, { tools: payload.tools, last_connected_at: payload.lastConnectedAt ?? new Date().toISOString() });
        setSelectedTool(null);
        setResult(null);
    }

    async function removeServer(server: McpServerView) {
        if (!window.confirm(`Remove MCP server “${server.name}” and its saved credentials?`)) return;
        setBusy(`delete-${server.id}`);
        const response = await fetch(`/api/mcp/${server.id}`, { method: "DELETE" });
        setBusy(null);
        if (!response.ok) {
            setError("Could not remove MCP server");
            return;
        }
        const remaining = servers.filter((entry) => entry.id !== server.id);
        setServers(remaining);
        if (selectedId === server.id) {
            setSelectedId(remaining[0]?.id ?? null);
            setSelectedTool(null);
            setResult(null);
        }
        router.refresh();
    }

    async function runTool() {
        if (!selectedServer || !tool) return;
        let args: unknown;
        try {
            args = JSON.parse(argumentsText);
        } catch {
            setError("Arguments must be valid JSON");
            return;
        }
        if (!args || typeof args !== "object" || Array.isArray(args)) {
            setError("Arguments must be a JSON object");
            return;
        }
        setBusy("run");
        setError(null);
        setResult(null);
        const response = await fetch(`/api/mcp/${selectedServer.id}/tools`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: tool.name, arguments: args }),
        });
        const payload = await response.json().catch(() => ({})) as { result?: McpResult; error?: string };
        setBusy(null);
        setConfirmRun(false);
        if (!response.ok || !payload.result) {
            setError(payload.error ?? "Tool execution failed");
            return;
        }
        setResult(payload.result);
    }

    return (
        <div className="space-y-5">
            <SectionHeading
                title="MCP servers"
                subtitle="Connect MCP servers and choose whether their tools are available to the planner or every subagent."
                action={
                    <button className="btn btn-primary" type="button" onClick={() => setShowForm((open) => !open)}>
                        <Icon name={showForm ? "x" : "plus"} className="h-3.5 w-3.5" />
                        {showForm ? "Close" : "Add server"}
                    </button>
                }
            />

            <div className="flex items-start gap-2 border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-[12px] text-muted">
                <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p>MCP tools may perform actions with the server's permissions. Connect only trusted servers. Agent calls always require operator approval; assigning a server to Subagents exposes it to every spawned worker, regardless of specialist type.</p>
            </div>

            {error && (
                <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-800">
                    <span>{error}</span>
                    <button type="button" className="icon-btn h-6! w-6!" onClick={() => setError(null)} aria-label="Dismiss error">
                        <Icon name="x" className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            {showForm && (
                <section className="card">
                    <header className="card-header">
                        <div>
                            <h2 className="card-title"><Icon name="server" className="h-4 w-4 text-muted" />Connect an MCP server</h2>
                            <p className="mt-0.5 text-[11px] text-faint">Use a remote Streamable HTTP or legacy SSE endpoint. Use HTTPS for remote servers.</p>
                        </div>
                    </header>
                    <form className="card-body space-y-3" onSubmit={addServer}>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="block space-y-1">
                                <span className="text-[12px] font-medium text-ink">Display name</span>
                                <input required maxLength={80} value={form.name} placeholder="Nmap MCP" onChange={(event) => setForm({ ...form, name: event.target.value })} />
                            </label>
                            <label className="block space-y-1">
                                <span className="text-[12px] font-medium text-ink">Transport</span>
                                <select value={form.transport} onChange={(event) => setForm({ ...form, transport: event.target.value as McpTransport })}>
                                    <option value="streamable-http">Streamable HTTP (recommended)</option>
                                    <option value="sse">Legacy SSE</option>
                                </select>
                            </label>
                            <label className="block space-y-1">
                                <span className="text-[12px] font-medium text-ink">Available to</span>
                                <select value={form.agentTarget} onChange={(event) => setForm({ ...form, agentTarget: event.target.value as McpAgentTarget })}>
                                    <option value="planner">Planner</option>
                                    <option value="subagent">All subagents</option>
                                </select>
                            </label>
                        </div>
                        <label className="block space-y-1">
                            <span className="text-[12px] font-medium text-ink">Server endpoint</span>
                            <input required type="url" value={form.endpoint} placeholder="https://tools.example.com/mcp" onChange={(event) => setForm({ ...form, endpoint: event.target.value })} />
                        </label>
                        <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                            <label className="block space-y-1">
                                <span className="text-[12px] font-medium text-ink">Bearer token <span className="font-normal text-faint">(optional)</span></span>
                                <input type="password" autoComplete="new-password" value={form.bearerToken} placeholder="Token is stored locally and never shown again" onChange={(event) => setForm({ ...form, bearerToken: event.target.value })} />
                            </label>
                            <button className="btn btn-primary" type="submit" disabled={busy === "save" || !form.name.trim() || !form.endpoint.trim()}>
                                <Icon name="plus" className="h-3.5 w-3.5" />{busy === "save" ? "Saving…" : "Save server"}
                            </button>
                        </div>
                    </form>
                </section>
            )}

            {servers.length === 0 ? (
                <Empty icon="server">No MCP servers configured.</Empty>
            ) : (
                <div className="grid gap-4 lg:grid-cols-[minmax(240px,0.36fr)_minmax(0,1fr)]">
                    <section className="card min-w-0">
                        <header className="card-header">
                            <h2 className="card-title"><Icon name="server" className="h-4 w-4 text-muted" />Servers</h2>
                            <span className="text-[11px] text-faint">{servers.length}</span>
                        </header>
                        <ul className="divide-y divide-border">
                            {servers.map((server) => (
                                <li key={server.id} className="flex items-start gap-2 px-3 py-3">
                                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setSelectedId(server.id); setSelectedTool(null); setResult(null); setError(null); }} aria-current={selectedId === server.id ? "true" : undefined}>
                                        <span className="flex items-center gap-2">
                                            <span className="truncate text-[13px] font-medium text-ink">{server.name}</span>
                                            {selectedId === server.id && <Badge tone="running">selected</Badge>}
                                        </span>
                                        <span className="mono mt-1 block truncate text-[10px] text-muted">{server.endpoint}</span>
                                        <span className="mt-1 block text-[10px] text-faint">{server.transport === "sse" ? "SSE" : "Streamable HTTP"} · {server.tools.length} tools · {server.agent_target === "planner" ? "Planner" : server.agent_target === "subagent" ? "All subagents" : "Operator only"}{server.hasBearerToken ? " · token set" : ""}</span>
                                    </button>
                                    <button type="button" className="icon-btn h-7! w-7! text-red-700" aria-label={`Remove ${server.name}`} title="Remove server" disabled={busy === `delete-${server.id}`} onClick={() => void removeServer(server)}>
                                        <Icon name="trash" className="h-3.5 w-3.5" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>

                    {selectedServer && (
                        <section className="card min-w-0">
                            <header className="card-header">
                                <div className="min-w-0">
                                    <h2 className="card-title truncate">{selectedServer.name}</h2>
                                    <p className="mt-0.5 text-[11px] text-faint">
                                        {selectedServer.last_connected_at
                                            ? `Tools discovered ${new Date(selectedServer.last_connected_at).toLocaleString()}`
                                            : "Not connected yet"}
                                    </p>
                                </div>
                                <button className="btn" type="button" disabled={busy === `connect-${selectedServer.id}`} onClick={() => void connectServer(selectedServer)}>
                                    <Icon name="workflow" className="h-3.5 w-3.5" />{busy === `connect-${selectedServer.id}` ? "Connecting…" : "Connect & discover"}
                                </button>
                            </header>
                            <div className="card-body space-y-4">
                                <label className="block max-w-sm space-y-1">
                                    <span className="text-[12px] font-medium text-ink">Available to agents</span>
                                    <select
                                        value={selectedServer.agent_target ?? ""}
                                        disabled={busy === `target-${selectedServer.id}`}
                                        onChange={(event) => void updateAgentTarget(
                                            selectedServer,
                                            event.target.value === "planner" || event.target.value === "subagent"
                                                ? event.target.value
                                                : null,
                                        )}
                                    >
                                        <option value="">Operator only (not assigned)</option>
                                        <option value="planner">Planner</option>
                                        <option value="subagent">All subagents</option>
                                    </select>
                                    <span className="block text-[10px] text-faint">All subagents receive these tools, regardless of their specialist type. Each agent call pauses for operator approval.</span>
                                </label>
                                {selectedServer.tools.length === 0 ? (
                                    <Empty icon="wrench">Connect to discover tools from this server.</Empty>
                                ) : (
                                    <div className="grid gap-4 xl:grid-cols-[minmax(180px,0.7fr)_minmax(0,1.3fr)]">
                                        <div className="min-w-0">
                                            <h3 className="mb-2 text-[12px] font-semibold text-ink">Available tools</h3>
                                            <ul className="divide-y divide-border border-y border-border">
                                                {selectedServer.tools.map((entry) => (
                                                    <li key={entry.name}>
                                                        <button type="button" className="w-full px-2 py-2 text-left hover:bg-hover" data-active={selectedTool === entry.name ? "true" : "false"} onClick={() => { setSelectedTool(entry.name); setArgumentsText("{}"); setConfirmRun(false); setResult(null); }}>
                                                            <span className="block break-all text-[12px] font-medium text-ink">{entry.name}</span>
                                                            {entry.description && <span className="mt-0.5 block line-clamp-2 text-[10px] leading-relaxed text-muted">{entry.description}</span>}
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>

                                        <div className="min-w-0 space-y-3">
                                            {tool ? (
                                                <>
                                                    <div>
                                                        <h3 className="break-all text-[13px] font-semibold text-ink">{tool.name}</h3>
                                                        {tool.description && <p className="mt-1 text-[11px] leading-relaxed text-muted">{tool.description}</p>}
                                                    </div>
                                                    <details>
                                                        <summary className="cursor-pointer text-[11px] font-medium text-link">Input schema</summary>
                                                        <pre className="mono scroll mt-2 max-h-48 overflow-auto rounded-md border border-border bg-subtle p-2 text-[10px] text-muted">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                                                    </details>
                                                    <label className="block space-y-1">
                                                        <span className="text-[12px] font-medium text-ink">Arguments (JSON)</span>
                                                        <textarea rows={6} spellCheck={false} className="mono! text-[11px]!" value={argumentsText} onChange={(event) => setArgumentsText(event.target.value)} aria-label="Tool arguments in JSON" />
                                                    </label>
                                                    {confirmRun ? (
                                                        <div className="space-y-2 border-l-2 border-amber-500 bg-amber-500/5 p-3">
                                                            <p className="text-[11px] leading-relaxed text-ink">This sends a real request to <strong>{selectedServer.name}</strong>. Confirm the target and arguments are authorized.</p>
                                                            <div className="flex flex-wrap gap-2">
                                                                <button className="btn btn-danger" type="button" disabled={busy === "run"} onClick={() => void runTool()}>
                                                                    <Icon name="play" className="h-3.5 w-3.5" />{busy === "run" ? "Running…" : "Run once"}
                                                                </button>
                                                                <button className="btn" type="button" disabled={busy === "run"} onClick={() => setConfirmRun(false)}>Cancel</button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <button className="btn btn-primary" type="button" onClick={() => { setError(null); setConfirmRun(true); }}>
                                                            <Icon name="play" className="h-3.5 w-3.5" />Review & run
                                                        </button>
                                                    )}
                                                    {result && (
                                                        <div>
                                                            <div className="mb-1 flex items-center gap-2">
                                                                <h3 className="text-[12px] font-semibold text-ink">Tool result</h3>
                                                                <Badge tone={result.isError ? "failed" : "completed"}>{result.isError ? "tool error" : "complete"}</Badge>
                                                            </div>
                                                            <pre className="mono scroll max-h-80 overflow-auto rounded-md border border-border bg-subtle p-3 text-[10px] text-ink">{JSON.stringify(result, null, 2)}</pre>
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <Empty icon="wrench">Select a discovered tool to inspect its input schema and run it.</Empty>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </section>
                    )}
                </div>
            )}
        </div>
    );
}