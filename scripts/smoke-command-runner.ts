import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  runWorkspaceCommand,
  runWorkspacePythonFile,
  writeWorkspacePythonFile,
} from "../lib/command-runner";

async function main() {
  const command = await runWorkspaceCommand("echo aegismind-command-smoke");
  assert.equal(command.ok, true, command.error ?? command.stderr);
  assert.match(command.stdout, /aegismind-command-smoke/i);
  assert.equal(command.cwd, process.cwd());

  assert.throws(() => runWorkspaceCommand(""), /cannot be empty/);
  await assert.rejects(runWorkspacePythonFile("../outside.py"), /simple .py filename/);

  const fileName = `smoke-${randomUUID()}.py`;
  let relativePath: string | undefined;
  try {
    relativePath = await writeWorkspacePythonFile(fileName, 'print("aegismind-python-smoke")\n');
    assert.match(relativePath, /agent-python[\\/]/);
    const python = await runWorkspacePythonFile(fileName);
    assert.equal(python.ok, true, `${python.error ?? ""}\n${python.stderr}`);
    assert.match(python.stdout, /aegismind-python-smoke/);
    assert.equal(python.cwd, process.cwd());
  } finally {
    if (relativePath) await unlink(path.resolve(process.cwd(), relativePath));
  }

  console.log("COMMAND AND PYTHON RUNNER SMOKE OK");
}

main().catch((error) => {
  console.error("COMMAND AND PYTHON RUNNER SMOKE FAILED:", error);
  process.exit(1);
});
