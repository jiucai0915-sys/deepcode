import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolExecutor } from "./registry.js";
import { requireString } from "./path-args.js";

const execAsync = promisify(exec);
const MAX_OUTPUT_CHARS = 40000;

function trimOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n\n... [command output truncated]`;
}

export const runCommandTool: ToolExecutor = {
  definition: {
    name: "run_command",
    description: "Run a shell command in the current workspace after user confirmation.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to run in the current workspace."
        }
      },
      required: ["command"]
    }
  },

  async execute(args, context) {
    const command = requireString(args, "command");
    const level = context.permissions.classifyCommand(command);
    const permission = await context.permissions.authorize(
      {
        level,
        category: "run_command",
        description: `Run command: ${command}`
      },
      context.confirm
    );

    if (!permission.allowed) {
      if (level === 4) {
        return `Error: command rejected by safety policy: ${command}`;
      }
      return permission.reason ?? "Permission denied.";
    }

    if (level === 4) {
      return `Error: command rejected by safety policy: ${command}`;
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        timeout: 30000,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 10
      });
      const output = [stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`]
        .filter(Boolean)
        .join("\n");
      return trimOutput(output || "Command completed with no output.");
    } catch (error) {
      const err = error as Error & { stdout?: string; stderr?: string; code?: number };
      const output = [
        `Command failed${typeof err.code === "number" ? ` with exit code ${err.code}` : ""}.`,
        err.stdout && `stdout:\n${err.stdout}`,
        err.stderr && `stderr:\n${err.stderr}`,
        !err.stdout && !err.stderr && err.message
      ]
        .filter(Boolean)
        .join("\n");
      return trimOutput(output);
    }
  }
};
