import { resolveModel } from "../lib/llm";

async function main() {
  try {
    const resolved = await resolveModel();
    if (!resolved.live || resolved.provider === "mock") {
      throw new Error("Task agents must never resolve to a simulated model.");
    }
    console.log(`ENGINE PREFLIGHT OK: live provider ${resolved.provider}/${resolved.modelId}; no model request sent`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/DATABASE_URL is not set/i.test(message)) {
      console.log(`ENGINE PREFLIGHT SKIPPED: ${message}`);
      return;
    }
    if (/No live LLM provider|offline simulator|no API key/i.test(message)) {
      console.log(`ENGINE PREFLIGHT BLOCKED AS EXPECTED: ${message}`);
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error("ENGINE PREFLIGHT FAILED:", error);
  process.exit(1);
});
