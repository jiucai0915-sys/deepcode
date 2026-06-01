import fs from "node:fs/promises";
import path from "node:path";
import { isDangerousPath } from "../security/permissions.js";
import { isInsideWorkspace, resolveWorkspacePath, toRelativePath } from "../security/workspace.js";
import { optionalNumber, requireString } from "./path-args.js";
import type { ToolExecutor } from "./registry.js";

const IGNORED = new Set(["node_modules", ".git", "dist", ".next", "coverage", ".turbo"]);
const MAX_ENTRIES = 500;

async function walk(dirPath: string, depth: number, prefix = "", state = { count: 0 }): Promise<string[]> {
  if (depth < 0 || state.count >= MAX_ENTRIES) return [];

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const visible = entries
    .filter((entry) => !IGNORED.has(entry.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

  const lines: string[] = [];
  for (const entry of visible) {
    if (state.count >= MAX_ENTRIES) {
      lines.push(`${prefix}... [truncated]`);
      break;
    }

    state.count++;
    const marker = entry.isDirectory() ? "/" : "";
    lines.push(`${prefix}${entry.name}${marker}`);

    if (entry.isDirectory()) {
      lines.push(...(await walk(path.join(dirPath, entry.name), depth - 1, `${prefix}  `, state)));
    }
  }

  return lines;
}

export const listDirectoryTool: ToolExecutor = {
  definition: {
    name: "list_directory",
    description: "List a directory tree inside the current workspace.",
    parameters: {
      type: "object",
      properties: {
        dir_path: {
          type: "string",
          description: "Directory path, relative to the current workspace."
        },
        max_depth: {
          type: "number",
          description: "Maximum depth to list. Defaults to 3."
        }
      },
      required: ["dir_path"]
    }
  },

  async execute(args) {
    const inputPath = requireString(args, "dir_path");
    const depth = Math.max(0, Math.min(optionalNumber(args, "max_depth", 3), 8));
    const dirPath = resolveWorkspacePath(inputPath);

    if (!isInsideWorkspace(dirPath) || isDangerousPath(dirPath)) {
      return "Error: list_directory is limited to directories inside the current workspace.";
    }

    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      return `Error: ${toRelativePath(dirPath)} is not a directory.`;
    }

    const lines = await walk(dirPath, depth);
    return `${toRelativePath(dirPath)}/\n${lines.join("\n")}`;
  }
};
