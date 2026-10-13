import { exec, execFile } from "node:child_process";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_OUTPUT_CHARS = 16_000;
const MAX_BUFFER_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;
const MAX_COMMAND_LENGTH = 4_000;
const MAX_PYTHON_SOURCE_LENGTH = 64_000;
const PYTHON_DIRECTORY = "agent-python";

export interface CommandResult {
  command: string;
  cwd: string;
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

function truncate(value: string): string {
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`;
}

function resultFrom(
  command: string,
  cwd: string,
  error: Error | null,
  stdout: string,
  stderr: string,
): CommandResult {
  const errorCode = error && "code" in error ? error.code : null;
  const exitCode = typeof errorCode === "number" ? errorCode : error ? null : 0;
  return {
    command,
    cwd,
    ok: !error,
    exitCode,
    stdout: truncate(stdout),
    stderr: truncate(stderr),
    ...(error ? { error: error.message } : {}),
  };
}

export function runWorkspaceCommand(command: string): Promise<CommandResult> {
  const normalized = command.trim();
  if (!normalized) throw new Error("Command cannot be empty.");
  if (normalized.length > MAX_COMMAND_LENGTH) {
    throw new Error(`Command exceeds the ${MAX_COMMAND_LENGTH}-character limit.`);
  }
  if (normalized.includes("\0")) throw new Error("Command cannot contain null characters.");

  const cwd = process.cwd();
  return new Promise((resolve) => {
    exec(
      normalized,
      {
        cwd,
        windowsHide: true,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER_BYTES,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        resolve(resultFrom(normalized, cwd, error, stdout, stderr));
      },
    );
  });
}

function validatePythonFileName(fileName: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.py$/i.test(fileName)) {
    throw new Error("Python file name must be a simple .py filename without path components.");
  }
}

async function pythonFilePath(fileName: string, mustExist: boolean): Promise<string> {
  validatePythonFileName(fileName);
  const workspace = await realpath(process.cwd());
  const requestedDirectory = path.resolve(workspace, PYTHON_DIRECTORY);
  await mkdir(requestedDirectory, { recursive: true });
  const directory = await realpath(requestedDirectory);
  if (!directory.startsWith(`${workspace}${path.sep}`)) {
    throw new Error("Python files must stay inside the workspace agent-python directory.");
  }
  const filePath = path.join(directory, fileName);
  try {
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("Python scripts must be regular files, not links or special files.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || mustExist) throw error;
  }
  return filePath;
}

export async function writeWorkspacePythonFile(fileName: string, source: string): Promise<string> {
  if (source.length > MAX_PYTHON_SOURCE_LENGTH) {
    throw new Error(`Python source exceeds the ${MAX_PYTHON_SOURCE_LENGTH}-character limit.`);
  }
  const filePath = await pythonFilePath(fileName, false);
  await writeFile(filePath, source, { encoding: "utf8", flag: "w" });
  return path.relative(process.cwd(), filePath);
}

export async function runWorkspacePythonFile(fileName: string): Promise<CommandResult> {
  const filePath = await pythonFilePath(fileName, true);
  const cwd = process.cwd();
  return new Promise((resolve) => {
    const run = (executable: string, args: string[]) => {
      execFile(
        executable,
        args,
        {
          cwd,
          windowsHide: true,
          timeout: COMMAND_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER_BYTES,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          if (
            process.platform === "win32" &&
            executable === "python" &&
            error &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            run("py", ["-3", "-u", filePath]);
            return;
          }
          resolve(resultFrom(`${executable} ${args.slice(0, -1).join(" ")} ${path.relative(cwd, filePath)}`.trim(), cwd, error, stdout, stderr));
        },
      );
    };
    run(process.platform === "win32" ? "python" : "python3", ["-u", filePath]);
  });
}
