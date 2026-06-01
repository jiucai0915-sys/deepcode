import fs from "node:fs/promises";
import path from "node:path";
import { toRelativePath } from "../security/workspace.js";

export interface FileChange {
  filePath: string;
  beforeContent: string | null;
  afterContent: string;
  operation: "create" | "overwrite" | "edit";
}

export class ChangeTracker {
  private readonly changes: FileChange[] = [];

  record(change: FileChange) {
    this.changes.push(change);
  }

  peek(): FileChange | null {
    return this.changes.at(-1) ?? null;
  }

  async undoLast(): Promise<string> {
    const change = this.changes.pop();
    if (!change) {
      return "No DeepCode file changes to undo.";
    }

    if (change.beforeContent === null) {
      await fs.unlink(change.filePath);
      return `Undid ${change.operation}: deleted ${toRelativePath(change.filePath)}.`;
    }

    await fs.mkdir(path.dirname(change.filePath), { recursive: true });
    await fs.writeFile(change.filePath, change.beforeContent, "utf8");
    return `Undid ${change.operation}: restored ${toRelativePath(change.filePath)}.`;
  }
}
