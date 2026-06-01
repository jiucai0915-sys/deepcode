import fs from "node:fs/promises";
import { isDangerousPath } from "../security/permissions.js";
import { isInsideWorkspace, resolveWorkspacePath, toRelativePath } from "../security/workspace.js";
import { requireString } from "./path-args.js";
import type { ToolExecutor } from "./registry.js";

export const editFileTool: ToolExecutor = {
  definition: {
    name: "edit_file",
    description: "Replace exactly one text block in a file inside the current workspace.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to edit, relative to the current workspace."
        },
        old_text: {
          type: "string",
          description: "Exact text to replace. It must appear once."
        },
        new_text: {
          type: "string",
          description: "Replacement text."
        }
      },
      required: ["file_path", "old_text", "new_text"]
    }
  },

  async execute(args, context) {
    const inputPath = requireString(args, "file_path");
    const oldText = requireString(args, "old_text");
    const newText = requireString(args, "new_text");
    const filePath = resolveWorkspacePath(inputPath);

    if (!isInsideWorkspace(filePath) || isDangerousPath(filePath)) {
      return "Error: edit_file is limited to files inside the current workspace.";
    }

    const content = await fs.readFile(filePath, "utf8");
    const first = content.indexOf(oldText);
    const last = content.lastIndexOf(oldText);

    if (first === -1) {
      return `Error: old_text was not found in ${toRelativePath(filePath)}.`;
    }

    if (first !== last) {
      return `Error: old_text appears multiple times in ${toRelativePath(filePath)}. Provide a larger unique block.`;
    }

    const permission = await context.permissions.authorize(
      {
        level: 2,
        category: "edit_file",
        description: `Edit ${toRelativePath(filePath)}: replace ${oldText.length} chars with ${newText.length} chars`
      },
      context.confirm
    );

    if (!permission.allowed) {
      return permission.reason ?? "Permission denied.";
    }

    const nextContent = content.replace(oldText, newText);
    await fs.writeFile(filePath, nextContent, "utf8");
    context.changeTracker?.record({
      filePath,
      beforeContent: content,
      afterContent: nextContent,
      operation: "edit"
    });
    return `Edited ${toRelativePath(filePath)}.`;
  }
};
