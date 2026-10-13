import { McpClient, type McpServerView } from "@/components/mcp-client";
import { listMcpServers } from "@/lib/mcp";
import { requirePageUser } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePageUser();
  const servers = await listMcpServers();
  const initialServers: McpServerView[] = servers.map(({ bearer_token, ...server }) => ({
    ...server,
    hasBearerToken: Boolean(bearer_token),
  }));
  return <McpClient initialServers={initialServers} />;
}
