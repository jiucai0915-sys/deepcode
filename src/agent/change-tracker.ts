import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { toRelativePath } from "../security/workspace.js";

const execFileAsync = promisify(execFile);

export interface FileSnapshot {
  filePath: string;
  beforeContent: string | null;
}

export interface RestorePoint {
  id: string;
  operation: "create" | "overwrite" | "edit";
  label: string;
  hadStash: boolean;
  snapshots: FileSnapshot[];
}

export class ChangeTracker {
  private readonly restorePoints: RestorePoint[] = [];

  constructor(private readonly cwd = process.cwd()) {}

  async createRestorePoint(
    operation: RestorePoint["operation"],
    label: string,
    snapshots: FileSnapshot[]
  ): Promise<RestorePoint> {
    await this.ensureGitRepository();

    const id = `deepcode-${Date.now()}-${this.restorePoints.length + 1}`;
    const message = `${id}: ${label}`;
    const dirtyBefore = (await this.git(["status", "--porcelain"])).trim().length > 0;

    if (dirtyBefore) {
      await this.git(["add", "-A"]);
      await this.git(["stash", "push", "-u", "-m", message]);
      await this.applyStash("stash@{0}");
    }

    const restorePoint: RestorePoint = {
      id,
      operation,
      label,
      hadStash: dirtyBefore,
      snapshots
    };
    this.restorePoints.push(restorePoint);
    return restorePoint;
  }

  peek(): RestorePoint | null {
    return this.restorePoints.at(-1) ?? null;
  }

  async undoLast(): Promise<string> {
    const restorePoint = this.restorePoints.pop();
    if (!restorePoint) {
      return "No DeepCode Git restore points to undo.";
    }

    const targetFiles = restorePoint.snapshots.map((snapshot) => toRelativePath(snapshot.filePath));
    await this.resetWorktree();

    if (restorePoint.hadStash) {
      const stashRef = await this.findStashRef(restorePoint.id);
      if (!stashRef) {
        this.restorePoints.push(restorePoint);
        return `Could not find Git stash restore point ${restorePoint.id}.`;
      }
      await this.popStash(stashRef);
    }

    await this.restoreTargetSnapshots(restorePoint.snapshots);

    return [
      `Restored Git restore point ${restorePoint.id}.`,
      targetFiles.length > 0 ? `Restored files:\n${targetFiles.map((file) => `- ${file}`).join("\n")}` : "No target files recorded."
    ].join("\n");
  }

  private async ensureGitRepository() {
    try {
      const output = await this.git(["rev-parse", "--is-inside-work-tree"]);
      if (output.trim() !== "true") {
        throw new Error("not inside a Git repository");
      }
    } catch {
      throw new Error("Cannot create Git restore point because current workspace is not a Git repository.");
    }
  }

  private async resetWorktree() {
    await this.git(["reset", "--hard", "HEAD"]);
    await this.git(["clean", "-fd"]);
  }

  private async applyStash(stashRef: string) {
    try {
      await this.git(["stash", "apply", "--index", stashRef]);
    } catch {
      await this.git(["stash", "apply", stashRef]);
    }
  }

  private async popStash(stashRef: string) {
    try {
      await this.git(["stash", "pop", "--index", stashRef]);
    } catch {
      await this.git(["stash", "pop", stashRef]);
    }
  }

  private async findStashRef(id: string): Promise<string | null> {
    const output = await this.git(["stash", "list", "--format=%gd%x00%s"]);
    for (const line of output.split(/\r?\n/)) {
      const [ref, subject] = line.split("\0");
      if (ref && subject?.includes(id)) {
        return ref;
      }
    }
    return null;
  }

  private async restoreTargetSnapshots(snapshots: FileSnapshot[]) {
    for (const snapshot of snapshots) {
      if (snapshot.beforeContent === null) {
        await fs.rm(snapshot.filePath, { force: true });
      } else {
        await fs.writeFile(snapshot.filePath, snapshot.beforeContent, "utf8");
      }
    }
  }

  private async git(args: string[]): Promise<string> {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: this.cwd,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 10
    });
    return [stdout, stderr].filter(Boolean).join("\n");
  }
}
