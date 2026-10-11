import type { Asset, AssetKind, Severity } from "./types";

/**
 * Deterministic, offline reconnaissance simulator.
 *
 * AegisMind's real engine drives Kali tooling through a recording MITM proxy.
 * This edition runs *locally only*: these functions never open a socket and
 * never contact a target. They derive stable, clearly-labelled sample output
 * from a hash of the inputs, which keeps the multi-agent loop, the two-graph
 * model and the UI fully exercisable without any network access.
 */

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUBDOMAIN_WORDS = ["api", "dev", "staging", "admin", "vpn", "mail", "cdn", "portal", "beta", "internal"];
const PATH_WORDS = ["login", "admin", "api/v1/users", "upload", "debug", "backup", ".git/config", "health"];
const TECHNIQUES = ["dns", "http", "port_scan", "content_discovery", "tls", "fuzz"] as const;
export type Technique = (typeof TECHNIQUES)[number];
export const RECON_TECHNIQUES = TECHNIQUES;

const FINDING_TEMPLATES: Array<{ title: string; severity: Severity; description: string }> = [
  { title: "Exposed version-control metadata", severity: "medium", description: "A repository metadata path is readable, which can disclose source code and history." },
  { title: "Default administrative credentials", severity: "high", description: "The administrative console accepts a well-known default credential pair." },
  { title: "Verbose error disclosure", severity: "low", description: "Stack traces are returned to the client, leaking framework and path information." },
  { title: "Outdated TLS configuration", severity: "medium", description: "The endpoint negotiates deprecated protocol versions and weak cipher suites." },
  { title: "Directory listing enabled", severity: "low", description: "Directory listings are enabled and enumerate files not meant to be public." },
  { title: "Potential injection point", severity: "high", description: "A parameter reflects unsanitised input in a way that may permit injection." },
];

export interface SimulatedAsset {
  kind: AssetKind;
  value: string;
  attributes?: Record<string, unknown>;
}

export interface SimulatedTraffic {
  method: string;
  url: string;
  status: number;
  request: string;
  response: string;
}

export interface SimulatedFinding {
  title: string;
  severity: Severity;
  description: string;
  evidence: string;
}

export interface SimulationResult {
  technique: Technique;
  summary: string;
  observations: string[];
  assets: SimulatedAsset[];
  finding?: SimulatedFinding;
  traffic: SimulatedTraffic;
}

/** Extract a bare hostname from any asset value (domain, host:port, or URL). */
export function extractHost(value: string): string {
  let host = value.trim();
  const scheme = host.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)/i);
  if (scheme) host = scheme[1]!;
  host = host.split("/")[0]!;
  host = host.replace(/:[0-9]+$/, "");
  return host;
}

function hostOf(asset: Asset): string {
  return extractHost(asset.value);
}

/** Techniques that make sense for each asset kind. */
const TECHNIQUES_BY_KIND: Record<Asset["kind"], Technique[]> = {
  root_domain: ["dns", "http", "tls", "content_discovery"],
  subdomain: ["dns", "http", "tls", "port_scan", "content_discovery"],
  ip: ["port_scan", "http"],
  service: ["http", "tls", "fuzz"],
  app: ["http", "content_discovery", "fuzz"],
  endpoint: ["http", "fuzz", "content_discovery"],
};

export function techniqueFor(asset: Asset, intentId: number): Technique {
  const options = TECHNIQUES_BY_KIND[asset.kind] ?? TECHNIQUES;
  const idx = hashString(`${asset.id}:${intentId}:${asset.value}`) % options.length;
  return options[idx]!;
}

export function simulateRecon(input: {
  taskId: number;
  intentId: number;
  asset: Asset;
  technique: Technique;
}): SimulationResult {
  const { taskId, intentId, asset, technique } = input;
  const seed = hashString(`${taskId}|${intentId}|${asset.id}|${technique}`);
  const rand = mulberry32(seed);
  const host = hostOf(asset);

  const observations: string[] = [
    `${technique} against ${host} completed (simulated).`,
  ];
  const assets: SimulatedAsset[] = [];

  if ((technique === "dns" || technique === "content_discovery") && host.includes(".") && /^[a-z0-9.-]+$/i.test(host)) {
    const count = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i += 1) {
      const word = SUBDOMAIN_WORDS[Math.floor(rand() * SUBDOMAIN_WORDS.length)]!;
      const value = `${word}.${host.replace(/^\*\./, "")}`;
      assets.push({ kind: "subdomain", value, attributes: { source: "simulated", technique } });
      observations.push(`resolved ${value} -> 203.0.113.${10 + Math.floor(rand() * 200)} (simulated)`);
    }
  }

  if (technique === "port_scan") {
    const ports = [22, 80, 443, 3306, 5432, 6379, 8080, 8443];
    const open = ports.filter(() => rand() > 0.55);
    for (const port of open) {
      const value = `${host}:${port}`;
      assets.push({ kind: "service", value, attributes: { source: "simulated", port, protocol: port === 22 ? "ssh" : "tcp" } });
      observations.push(`port ${port}/tcp open (simulated)`);
    }
    if (!open.length) observations.push("no additional open ports observed (simulated)");
  }

  if (technique === "http" || technique === "content_discovery" || technique === "fuzz") {
    const count = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i += 1) {
      const path = PATH_WORDS[Math.floor(rand() * PATH_WORDS.length)]!;
      const base = host.startsWith("http") ? host : `https://${host}`;
      assets.push({
        kind: "endpoint",
        value: `${base}/${path}`,
        attributes: { source: "simulated", technique, status: [200, 301, 302, 403, 500][Math.floor(rand() * 5)] },
      });
      observations.push(`endpoint ${path} responded (simulated)`);
    }
  }

  if (technique === "tls") {
    observations.push("negotiated TLS 1.2 with a deprecated cipher suite (simulated)");
    assets.push({
      kind: "service",
      value: `${host}:443`,
      attributes: { source: "simulated", tls: { protocols: ["TLSv1.2", "TLSv1.3"], weakCipher: true } },
    });
  }

  const finding = rand() > 0.45 ? { ...FINDING_TEMPLATES[Math.floor(rand() * FINDING_TEMPLATES.length)]! } : undefined;
  const status = finding ? 200 : [200, 204, 301, 403][Math.floor(rand() * 4)]!;
  const url = host.startsWith("http") ? host : `https://${host}`;

  const result: SimulationResult = {
    technique,
    summary: `${technique} reconnaissance of ${host} (simulated)`,
    observations,
    assets,
    traffic: {
      method: technique === "http" || technique === "content_discovery" ? "GET" : "CONNECT",
      url: technique === "dns" ? `dns://${host}` : `${url}/`,
      status,
      request: [`# simulated ${technique} request`, `target: ${host}`, `task: ${taskId}`, `intent: ${intentId}`].join("\n"),
      response:
        [`# simulated ${technique} response`, ...observations.map((o) => `- ${o}`)].join("\n") +
        (finding ? `\n- signal: ${finding.title}` : ""),
    },
  };

  if (finding) {
    result.finding = {
      title: finding.title,
      severity: finding.severity,
      description: finding.description,
      evidence: `${observations.join("; ")} — reported by simulated ${technique} against ${host}.`,
    };
  }

  return result;
}
