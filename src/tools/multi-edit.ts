import fs from "node:fs/promises";
import { isDangerousPath } from "../security/permissions.js";
import { isInsideWorkspace, resolveWorkspacePath, toRelativePath } from "../security/workspace.js";
import { requireString } from "./path-args.js";
import type { ToolExecutor } from "./registry.js";

interface TextEdit {
  old_text: string;
  new_text: string;
}

function parseEdits(value: unknown): TextEdit[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('missing required non-empty array argument "edits"');
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`edits[${index}] must be an object`);
    }

    const edit = item as Record<string, unknown>;
    if (typeof edit.old_text !== "string" || edit.old_text.length === 0) {
      throw new Error(`edits[${index}].old_text must be a non-empty string`);
    }
    if (typeof edit.new_text !== "string") {
      throw new Error(`edits[${index}].new_text must be a string`);
    }

    return {
      old_text: edit.old_text,
      new_text: edit.new_text
    };
  });
}

export const multiEditTool: ToolExecutor = {
  definition: {
    name: "multi_edit",
    description: "Apply multiple exact text replacements to one file atomically after validation.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path to edit, relative to the current workspace."
        },
        edits: {
          type: "array",
          description: "Ordered replacement list. Every old_text must match exactly once.",
          items: {
            type: "object",
            properties: {
              old_text: {
                type: "string",
                description: "Exact text to replace. It must appear once at the time this edit is applied."
              },
              new_text: {
                type: "string",
                description: "Replacement text."
              }
            },
            required: ["old_text", "new_text"]
          }
        }
      },
      required: ["file_path", "edits"]
    }
  },

  async execute(args, context) {
    const inputPath = requireString(args, "file_path");
    const edits = parseEdits(args.edits);
    const filePath = resolveWorkspacePath(inputPath);

    if (!isInsideWorkspace(filePath) || isDangerousPath(filePath)) {
      return "Error: multi_edit is limited to files inside the current workspace.";
    }

    const beforeContent = await fs.readFile(filePath, "utf8");
    let nextContent = beforeContent;

    for (let index = 0; index < edits.length; index++) {
      const edit = edits[index];
      const first = nextContent.indexOf(edit.old_text);
      const last = nextContent.lastIndexOf(edit.old_text);

      if (first === -1) {
        return `Error: edits[${index}].old_text was not found in ${toRelativePath(filePath)}. No changes were written.`;
      }

      if (first !== last) {
        return `Error: edits[${index}].old_text appears multiple times in ${toRelativePath(filePath)}. No changes were written.`;
      }

      nextContent = nextContent.replace(edit.old_text, edit.new_text);
    }

    const permission = await context.permissions.authorize(
      {
        level: 2,
        category: "multi_edit",
        description: `Apply ${edits.length} edits to ${toRelativePath(filePath)}`
      },
      context.confirm
    );

    if (!permission.allowed) {
      return permission.reason ?? "Permission denied.";
    }

    try {
      await context.changeTracker?.createRestorePoint(
        "edit",
        `Apply ${edits.length} edits to ${toRelativePath(filePath)}`,
        [{ filePath, beforeContent }]
      );
    } catch (error) {
      return `Error: ${(error as Error).message}`;
    }

    await fs.writeFile(filePath, nextContent, "utf8");

    return `Applied ${edits.length} edits to ${toRelativePath(filePath)}.`;
  }
};
