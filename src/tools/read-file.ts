import fs from "node:fs/promises";
import { isDangerousPath } from "../security/permissions.js";
import { isInsideWorkspace, resolveWorkspacePath, toRelativePath } from "../security/workspace.js";
import { requireString } from "./path-args.js";
import type { ToolExecutor } from "./registry.js";

const MAX_FILE_CHARS = 50000;

export const readFileTool: ToolExecutor = {
  definition: {
    name: "read_file",
    description: "Read a text file inside the current workspace.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to read, relative to the current workspace."
        }
      },
      required: ["file_path"]
    }
  },

  async execute(args) {
    const inputPath = requireString(args, "file_path");
    const filePath = resolveWorkspacePath(inputPath);

    if (!isInsideWorkspace(filePath) || isDangerousPath(filePath)) {
      return "Error: read_file is limited to files inside the current workspace.";
    }

    const content = await fs.readFile(filePath, "utf8");
    if (content.length > MAX_FILE_CHARS) {
      return `${content.slice(0, MAX_FILE_CHARS)}\n\n... [truncated ${toRelativePath(filePath)}]`;
    }
    return content;
  }
};
