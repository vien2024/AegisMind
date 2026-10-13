import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  assessValidationResponse,
  craftValidationPayload,
  sendValidationProbe,
} from "../lib/validator";

const findingContext = {
  taskId: 4,
  intentId: 8,
  findingId: 12,
  parameter: "search",
};

const xssPayload = craftValidationPayload({ ...findingContext, type: "reflected_xss" });
assert.equal(xssPayload, craftValidationPayload({ ...findingContext, type: "reflected_xss" }));
assert.match(xssPayload, /^<script>void\(0\)<\/script>AEGIS-[a-f0-9]{16}$/);
assert.equal(craftValidationPayload({ ...findingContext, type: "sql_error" }), "'");

assert.equal(
  assessValidationResponse("sql_error", "'", {
    status: 500,
    contentType: "text/html",
    body: "Database error: You have an error in your SQL syntax",
  }).verdict,
  "confirmed",
);
assert.equal(
  assessValidationResponse("sql_error", "'", {
    status: 200,
    contentType: "application/json",
    body: '{"error":"invalid input"}',
  }).verdict,
  "not_confirmed",
);

const reflected = assessValidationResponse("reflected_xss", xssPayload, {
  status: 200,
  contentType: "text/html; charset=utf-8",
  body: `<html>${xssPayload}</html>`,
});
assert.equal(reflected.verdict, "potential");
assert.match(reflected.result, /Script execution was not tested/);

const cspReflected = assessValidationResponse("reflected_xss", xssPayload, {
  status: 200,
  contentType: "text/html",
  csp: "default-src 'self'",
  body: xssPayload,
});
assert.equal(cspReflected.verdict, "potential");
assert.match(cspReflected.result, /CSP blocks inline scripts/);

const priorPrivateOptIn = process.env.AEGISMIND_ALLOW_PRIVATE_VALIDATION_TARGETS;
const priorLiveValidation = process.env.AEGISMIND_ENABLE_LIVE_VALIDATION;
delete process.env.AEGISMIND_ENABLE_LIVE_VALIDATION;
delete process.env.AEGISMIND_ALLOW_PRIVATE_VALIDATION_TARGETS;
await assert.rejects(
  sendValidationProbe(new URL("http://127.0.0.1/"), "sql_error", "'", "search"),
  /Live validation is disabled/,
);
process.env.AEGISMIND_ENABLE_LIVE_VALIDATION = "true";
await assert.rejects(
  sendValidationProbe(new URL("http://example.com/"), "sql_error", "DROP TABLE users", "search"),
  /Only built-in non-destructive validation payloads/,
);
try {
  await assert.rejects(
    sendValidationProbe(new URL("http://127.0.0.1/"), "sql_error", "'", "search"),
    /private or reserved address/,
  );
} finally {
  if (priorPrivateOptIn !== undefined) {
    process.env.AEGISMIND_ALLOW_PRIVATE_VALIDATION_TARGETS = priorPrivateOptIn;
  }
  if (priorLiveValidation !== undefined) {
    process.env.AEGISMIND_ENABLE_LIVE_VALIDATION = priorLiveValidation;
  } else {
    delete process.env.AEGISMIND_ENABLE_LIVE_VALIDATION;
  }
}

process.env.AEGISMIND_ENABLE_LIVE_VALIDATION = "true";
process.env.AEGISMIND_ALLOW_PRIVATE_VALIDATION_TARGETS = "true";
await assert.rejects(
  sendValidationProbe(new URL("http://169.254.169.254/"), "sql_error", "'", "search"),
  /Metadata and link-local addresses are always blocked/,
);

let requestCount = 0;
const server = createServer((request, response) => {
  requestCount += 1;
  assert.equal(request.method, "GET");
  if (request.url?.startsWith("/redirect")) {
    response.writeHead(302, { location: "/echo" });
    response.end();
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<html>${new URL(request.url ?? "/", "http://localhost").searchParams.get("search")}</html>`);
});
process.env.AEGISMIND_ENABLE_LIVE_VALIDATION = "true";
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
assert.ok(address && typeof address !== "string");
process.env.AEGISMIND_ALLOW_PRIVATE_VALIDATION_TARGETS = "true";
try {
  const response = await sendValidationProbe(
    new URL(`http://127.0.0.1:${address.port}/echo`),
    "reflected_xss",
    xssPayload,
    "search",
  );
  assert.equal(response.status, 200);
  assert.equal(assessValidationResponse("reflected_xss", xssPayload, response).verdict, "potential");
  const redirect = await sendValidationProbe(
    new URL(`http://127.0.0.1:${address.port}/redirect`),
    "reflected_xss",
    xssPayload,
    "search",
  );
  assert.equal(redirect.status, 302);
  assert.equal(requestCount, 2);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (priorPrivateOptIn !== undefined) {
    process.env.AEGISMIND_ALLOW_PRIVATE_VALIDATION_TARGETS = priorPrivateOptIn;
  } else {
    delete process.env.AEGISMIND_ALLOW_PRIVATE_VALIDATION_TARGETS;
  }
  if (priorLiveValidation !== undefined) {
    process.env.AEGISMIND_ENABLE_LIVE_VALIDATION = priorLiveValidation;
  } else {
    delete process.env.AEGISMIND_ENABLE_LIVE_VALIDATION;
  }
}

console.log("VALIDATOR SMOKE OK");
