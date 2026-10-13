import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export const VALIDATOR_TYPES = ["reflected_xss", "sql_error"] as const;
export type ValidatorType = (typeof VALIDATOR_TYPES)[number];

export type ValidationVerdict = "confirmed" | "potential" | "not_confirmed" | "inconclusive";

const MAX_RESPONSE_BYTES = 32 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

const blockedAddresses = new BlockList();
for (const [subnet, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(subnet, prefix, "ipv4");
}
for (const [subnet, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(subnet, prefix, "ipv6");
}

function tokenFor(input: { taskId: number; intentId: number; findingId: number; parameter: string; type: ValidatorType }): string {
  return createHash("sha256")
    .update(`${input.taskId}:${input.intentId}:${input.findingId}:${input.parameter}:${input.type}`)
    .digest("hex")
    .slice(0, 16);
}

export function craftValidationPayload(input: {
  taskId: number;
  intentId: number;
  findingId: number;
  parameter: string;
  type: ValidatorType;
}): string {
  const token = tokenFor(input);
  return input.type === "reflected_xss"
    ? `<script>void(0)</script>AEGIS-${token}`
    : "'";
}

export function assessValidationResponse(
  type: ValidatorType,
  payload: string,
  response: { status: number; contentType: string; csp?: string | null; body: string },
): { verdict: ValidationVerdict; result: string } {
  if (type === "sql_error") {
    const signatures = [
      /SQLSTATE\[[0-9A-Z]+\]/i,
      /error in your SQL syntax/i,
      /SQL syntax.{0,80}error/i,
      /unterminated quoted string/i,
      /quoted string not properly terminated/i,
      /syntax error at or near/i,
      /sqlite(?:3)?\.(?:operational|database)error/i,
      /ORA-\d{5}/i,
      /Microsoft OLE DB Provider for SQL Server/i,
      /ODBC SQL Server Driver/i,
    ];
    const signature = signatures.find((candidate) => candidate.test(response.body));
    if (signature) {
      return {
        verdict: "confirmed",
        result: `HTTP ${response.status}; response matched database error signature "${signature.source}".`,
      };
    }
    return {
      verdict: "not_confirmed",
      result: `HTTP ${response.status}; no recognized database error signature followed the quote probe.`,
    };
  }

  const reflected = response.body.includes(payload);
  if (reflected && /text\/html/i.test(response.contentType)) {
    const directives = (response.csp ?? "")
      .split(";")
      .map((directive) => directive.trim().toLowerCase().split(/\s+/));
    const scriptPolicy = directives.find((directive) => directive[0] === "script-src-elem")
      ?? directives.find((directive) => directive[0] === "script-src")
      ?? directives.find((directive) => directive[0] === "default-src");
    const policyNote =
      scriptPolicy && !scriptPolicy.includes("'unsafe-inline'")
        ? " The response CSP blocks inline scripts."
        : "";
    return {
      verdict: "potential",
      result: `HTTP ${response.status}; the inert script canary was reflected in an HTML response.${policyNote} Script execution was not tested, so this is not confirmed XSS.`,
    };
  }
  return {
    verdict: "not_confirmed",
    result: `HTTP ${response.status}; the script canary was not reflected as raw text in an HTML response.`,
  };
}

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return blockedAddresses.check(address, "ipv4") || address === "168.63.129.16";
  }
  return family === 6 && blockedAddresses.check(address, "ipv6");
}

function isAlwaysBlockedAddress(address: string): boolean {
  return (
    address === "168.63.129.16" ||
    address.startsWith("169.254.") ||
    address.toLowerCase().startsWith("fe80:") ||
    /::ffff:169\.254\./i.test(address)
  );
}

async function resolveTarget(hostname: string): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const normalizedHostname = hostname.replace(/^\[|\]$/g, "");
  const family = isIP(normalizedHostname);
  if (family) return [{ address: normalizedHostname, family: family as 4 | 6 }];
  return (await lookup(normalizedHostname, { all: true, verbatim: true })).map((entry) => ({
    address: entry.address,
    family: entry.family as 4 | 6,
  }));
}

interface SafeHttpResponse {
  status: number;
  contentType: string;
  csp: string | null;
  body: string;
  truncated: boolean;
}

async function sendSafeHttpGet(target: URL, userAgent: string): Promise<SafeHttpResponse> {
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS endpoints are supported.");
  }
  if (target.username || target.password || target.hash) {
    throw new Error("Endpoint URLs cannot include credentials or fragments.");
  }
  if (target.toString().length > 2_048) throw new Error("Endpoint URLs cannot exceed 2,048 characters.");
  const allowedPorts = target.protocol === "https:" ? ["", "443"] : ["", "80"];
  if (!allowedPorts.includes(target.port) && process.env.AEGISMIND_ALLOW_PRIVATE_VALIDATION_TARGETS !== "true") {
    throw new Error("Non-standard ports require AEGISMIND_ALLOW_PRIVATE_VALIDATION_TARGETS=true.");
  }

  const addresses = await resolveTarget(target.hostname);
  if (!addresses.length) throw new Error("The endpoint hostname did not resolve.");
  const allowPrivate = process.env.AEGISMIND_ALLOW_PRIVATE_VALIDATION_TARGETS === "true";
  if (addresses.some((entry) => isAlwaysBlockedAddress(entry.address))) {
    throw new Error("Metadata and link-local addresses are always blocked.");
  }
  if (addresses.some((entry) => isBlockedAddress(entry.address)) && !allowPrivate) {
    throw new Error("The endpoint resolves to a private or reserved address. Private targets require explicit opt-in.");
  }

  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options && typeof options === "object" && "all" in options && options.all) {
      callback(null, addresses);
      return;
    }
    const address = addresses[0]!;
    callback(null, address.address, address.family);
  };

  return new Promise((resolve, reject) => {
    let body = "";
    let truncated = false;
    let settled = false;
    const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
    const request = transport(
      new URL(target),
      {
        method: "GET",
        headers: {
          Accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.1",
          "User-Agent": userAgent,
        },
        lookup: pinnedLookup,
      },
      (response) => {
        response.setEncoding("utf8");
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({
            status: response.statusCode ?? 0,
            contentType: [response.headers["content-type"]].flat().filter(Boolean).join(", "),
            csp: [response.headers["content-security-policy"]].flat().filter(Boolean).join(", ") || null,
            body,
            truncated,
          });
        };
        response.on("data", (chunk: string) => {
          const remaining = MAX_RESPONSE_BYTES - Buffer.byteLength(body, "utf8");
          if (remaining <= 0) {
            truncated = true;
            response.destroy();
            return;
          }
          const next = Buffer.from(chunk, "utf8");
          if (next.length > remaining) {
            body += next.subarray(0, remaining).toString("utf8");
            truncated = true;
            response.destroy();
            return;
          }
          body += chunk;
        });
        response.on("end", finish);
        response.on("close", finish);
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("HTTP request timed out.")));
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    request.end();
  });
}

export async function sendValidationProbe(
  target: URL,
  type: ValidatorType,
  payload: string,
  parameter: string,
): Promise<{ status: number; contentType: string; csp: string | null; body: string; truncated: boolean }> {
  if (process.env.AEGISMIND_ENABLE_LIVE_VALIDATION !== "true") {
    throw new Error("Live validation is disabled.");
  }
  if (
    (type === "sql_error" && payload !== "'") ||
    (type === "reflected_xss" && !/^<script>void\(0\)<\/script>AEGIS-[a-f0-9]{16}$/.test(payload))
  ) {
    throw new Error("Only built-in non-destructive validation payloads are supported.");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(parameter)) {
    throw new Error("The query parameter name is invalid.");
  }
  const requestUrl = new URL(target);
  requestUrl.searchParams.set(parameter, payload);
  const response = await sendSafeHttpGet(requestUrl, "AegisMind-Validator/1.0");
  return {
    status: response.status,
    contentType: response.contentType,
    csp: response.csp,
    body: response.body,
    truncated: response.truncated,
  };
}
