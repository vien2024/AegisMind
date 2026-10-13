import type { Asset, AssetKind } from "./types";

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
const TECHNIQUES = ["dns", "http", "port_scan", "content_discovery", "tls", "fuzz", "xss", "sqli", "xxe"] as const;
export type Technique = (typeof TECHNIQUES)[number];
export const RECON_TECHNIQUES = TECHNIQUES;

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

export interface SimulationResult {
  technique: Technique;
  summary: string;
  observations: string[];
  assets: SimulatedAsset[];
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

  if (["xss", "sqli", "xxe"].includes(technique)) {
    observations.push(`${technique.toUpperCase()} specialist check is a simulation only; no payload was sent and no vulnerability was verified.`);
  }

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

  if (asset.kind === "endpoint" && ["http", "content_discovery", "fuzz"].includes(technique)) {
    const endpointPath = asset.value.toLowerCase().replace(/^[a-z]+:\/\/[^/]+/, "");
    observations.push(`endpoint mapped: ${asset.value} (simulated).`);
    observations.push("candidate parameters to review: id, q, redirect, file (synthetic examples, not observed from a live request).");
    observations.push(
      /login|signin|auth|session/.test(endpointPath)
        ? "authentication flow: login/session route candidate; flow was not observed in this offline simulation."
        : "authentication flow: not observable in this offline simulation.",
    );
    if (asset.attributes?.mapping_depth !== 1 && endpointPath.split("/").filter(Boolean).length <= 1) {
      const base = asset.value.replace(/\/$/, "");
      for (const path of ["admin", "api", "login"]) {
        assets.push({
          kind: "endpoint",
          value: `${base}/${path}`,
          attributes: { source: "simulated", technique, mapping_depth: 1 },
        });
        observations.push(`hidden-path candidate ${path} (synthetic; not discovered from a live response).`);
      }
    }
  } else if (technique === "http" || technique === "content_discovery" || technique === "fuzz") {
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

  const status = [200, 204, 301, 403][Math.floor(rand() * 4)]!;
  const url = asset.kind === "endpoint" ? asset.value : host.startsWith("http") ? host : `https://${host}`;

  const result: SimulationResult = {
    technique,
    summary: `${technique} reconnaissance of ${host} (simulated)`,
    observations,
    assets,
    traffic: {
      method: ["http", "content_discovery", "fuzz", "xss", "sqli", "xxe"].includes(technique) ? "GET" : "CONNECT",
      url: technique === "dns" ? `dns://${host}` : url,
      status,
      request: [`# simulated ${technique} request`, `target: ${host}`, `task: ${taskId}`, `intent: ${intentId}`].join("\n"),
      response: [`# simulated ${technique} response`, ...observations.map((o) => `- ${o}`)].join("\n"),
    },
  };

  return result;
}
