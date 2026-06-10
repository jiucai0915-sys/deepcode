import fs from "node:fs/promises";
import path from "node:path";
import { isDangerousPath } from "../security/permissions.js";
import { isInsideWorkspace, resolveWorkspacePath, toRelativePath } from "../security/workspace.js";
import { requireString } from "./path-args.js";
import type { ToolExecutor } from "./registry.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export const writeFileTool: ToolExecutor = {
  definition: {
    name: "write_file",
    description: "Create or overwrite a text file inside the current workspace.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to write, relative to the current workspace."
        },
        content: {
          type: "string",
          description: "Full file content to write."
        }
      },
      required: ["file_path", "content"]
    }
  },

  async execute(args, context) {
    const inputPath = requireString(args, "file_path");
    const content = requireString(args, "content");
    const filePath = resolveWorkspacePath(inputPath);

    if (!isInsideWorkspace(filePath) || isDangerousPath(filePath)) {
      return "Error: write_file is limited to files inside the current workspace.";
    }

    const existed = await exists(filePath);
    const permission = await context.permissions.authorize(
      {
        level: existed ? 3 : 2,
        category: existed ? "write_file:overwrite" : "write_file:create",
        description: `${existed ? "Overwrite" : "Create"} ${toRelativePath(filePath)} (${content.length} chars)`
      },
      context.confirm
    );

    if (!permission.allowed) {
      return permission.reason ?? "Permission denied.";
    }

    const beforeContent = existed ? await fs.readFile(filePath, "utf8") : null;
    try {
      await context.changeTracker?.createRestorePoint(
        existed ? "overwrite" : "create",
        `${existed ? "Overwrite" : "Create"} ${toRelativePath(filePath)}`,
        [{ filePath, beforeContent }]
      );
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    return `${existed ? "Overwrote" : "Created"} ${toRelativePath(filePath)}.`;
  }
};
