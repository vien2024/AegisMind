import type { IconName } from "@/components/shell/icons";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Sections that belong to the upstream Go edition and are not implemented here. */
  upstreamOnly?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Features",
    items: [
      { href: "/", label: "Dashboard", icon: "dashboard" },
      { href: "/chat", label: "Chat", icon: "chat" },
      { href: "/tasks", label: "Tasks", icon: "target" },
      { href: "/findings", label: "Findings", icon: "bug" },
      { href: "/traffic", label: "Traffic", icon: "activity" },
      { href: "/tool-executions", label: "Tool executions", icon: "terminal" },
      { href: "/llm-recordings", label: "LLM recordings", icon: "audioLines" },
      { href: "/assets", label: "Assets", icon: "box" },
      { href: "/asset-sync", label: "Asset sync", icon: "refresh", upstreamOnly: true },
      { href: "/workspace", label: "Workspace", icon: "grid", upstreamOnly: true },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/llm", label: "LLM", icon: "cpu" },
      { href: "/agent", label: "Agent", icon: "bot", upstreamOnly: true },
      { href: "/mcp", label: "MCP", icon: "server" },
      { href: "/skill", label: "Skill", icon: "sparkles", upstreamOnly: true },
      { href: "/tool", label: "Tool", icon: "wrench", upstreamOnly: true },
      { href: "/notifications", label: "Notifications", icon: "bell", upstreamOnly: true },
      { href: "/interception-rules", label: "Interception rules", icon: "shield" },
      { href: "/asset-blocking", label: "Asset blocking", icon: "shieldOff", upstreamOnly: true },
      { href: "/approval-records", label: "Approval records", icon: "checkCircle" },
      { href: "/logs", label: "Logs", icon: "fileText" },
      { href: "/settings", label: "System settings", icon: "settings" },
    ],
  },
];

export const UPSTREAM_SECTIONS: Record<string, { title: string; blurb: string }> = {
  "/asset-sync": {
    title: "Asset sync",
    blurb:
      "Upstream syncs assets from a ScopeSentry instance. This Next.js edition keeps a single local asset graph and has no external asset source.",
  },
  "/workspace": {
    title: "Workspace",
    blurb: "Upstream's shared agent workspace (skills, notes and files) is not part of this local edition.",
  },
  "/agent": {
    title: "Agent",
    blurb: "Upstream lets you edit each agent's prompt, LLM binding and run budget. This edition keeps agent instructions in code.",
  },
  "/mcp": {
    title: "MCP",
    blurb: "Connect trusted MCP servers over Streamable HTTP or SSE and invoke tools explicitly.",
  },
  "/skill": {
    title: "Skill",
    blurb: "Upstream loads markdown skill guidance from the ./skills directory. Not included here.",
  },
  "/tool": {
    title: "Tool",
    blurb: "Upstream manages Kali tool bindings and custom Python scripts. General reconnaissance tools are not included in this edition.",
  },
  "/notifications": {
    title: "Notifications",
    blurb: "Upstream can push notifications to external channels. Not included here.",
  },
  "/asset-blocking": {
    title: "Asset blocking",
    blurb: "Upstream blocks assets from being tested. Not included here.",
  },
};
