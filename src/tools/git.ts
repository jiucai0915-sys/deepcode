import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isDangerousPath } from "../security/permissions.js";
import { isInsideWorkspace, resolveWorkspacePath } from "../security/workspace.js";
import type { ToolExecutor } from "./registry.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_CHARS = 50000;

function trimGitOutput(output: string): string {
  if (output.length <= MAX_GIT_OUTPUT_CHARS) return output;
  return `${output.slice(0, MAX_GIT_OUTPUT_CHARS)}\n\n... [git output truncated]`;
}

function getRepoPath(args: Record<string, unknown>): string {
  const repoInput = typeof args.repo_path === "string" && args.repo_path ? args.repo_path : ".";
  const repoPath = resolveWorkspacePath(repoInput);

  if (!isInsideWorkspace(repoPath) || isDangerousPath(repoPath)) {
    throw new Error("git tools are limited to repositories inside the current workspace");
  }

  return repoPath;
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd: repoPath,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 10
    });
    return trimGitOutput([stdout, stderr].filter(Boolean).join("\n") || "No output.");
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string; code?: number };
    return trimGitOutput(
      [
        `git ${args.join(" ")} failed${typeof err.code === "number" ? ` with exit code ${err.code}` : ""}.`,
        err.stdout,
        err.stderr,
        !err.stdout && !err.stderr && err.message
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

async function runGitOrThrow(repoPath: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd: repoPath,
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 1024 * 1024 * 10
  });
  return trimGitOutput([stdout, stderr].filter(Boolean).join("\n") || "No output.");
}

export const gitStatusTool: ToolExecutor = {
  definition: {
    name: "git_status",
    description: "Show read-only git status for a repository inside the current workspace.",
    parameters: {
      type: "object",
      properties: {
        repo_path: {
          type: "string",
          description: "Repository path relative to the current workspace. Defaults to current workspace."
        }
      }
    }
  },

  async execute(args) {
    return runGit(getRepoPath(args), ["status", "--short", "--branch"]);
  }
};

export const gitDiffTool: ToolExecutor = {
  definition: {
    name: "git_diff",
    description: "Show read-only uncommitted git diff for a repository inside the current workspace.",
    parameters: {
      type: "object",
      properties: {
        repo_path: {
          type: "string",
          description: "Repository path relative to the current workspace. Defaults to current workspace."
        }
      }
    }
  },

  async execute(args) {
    const output = await runGit(getRepoPath(args), ["diff", "--no-ext-diff", "--"]);
    return output.trim() ? output : "No uncommitted changes.";
  }
};

export const gitLogTool: ToolExecutor = {
  definition: {
    name: "git_log",
    description: "Show recent git commits for a repository inside the current workspace.",
    parameters: {
      type: "object",
      properties: {
        repo_path: {
          type: "string",
          description: "Repository path relative to the current workspace. Defaults to current workspace."
        },
        max_count: {
          type: "number",
          description: "Maximum commits to show. Defaults to 10."
        }
      }
    }
  },

  async execute(args) {
    const maxCount = typeof args.max_count === "number" && Number.isFinite(args.max_count)
      ? Math.max(1, Math.min(Math.floor(args.max_count), 50))
      : 10;
    return runGit(getRepoPath(args), [
      "log",
      `--max-count=${maxCount}`,
      "--date=short",
      "--pretty=format:%h %ad %s"
    ]);
  }
};

export const gitCommitTool: ToolExecutor = {
  definition: {
    name: "git_commit",
    description: "Commit git changes in a repository inside the current workspace after Level 3 confirmation.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Commit message."
        },
        repo_path: {
          type: "string",
          description: "Repository path relative to the current workspace. Defaults to current workspace."
        },
        all: {
          type: "boolean",
          description: "If true, run git add -A before committing. Defaults to false."
        }
      },
      required: ["message"]
    }
  },

  async execute(args, context) {
    const message = args.message;
    if (typeof message !== "string" || !message.trim()) {
      throw new Error('missing required string argument "message"');
    }

    const repoPath = getRepoPath(args);
    const stageAll = args.all === true;
    const permission = await context.permissions.authorize(
      {
        level: 3,
        category: "git_commit",
        description: `Commit git changes${stageAll ? " after git add -A" : ""}: ${message}`
      },
      context.confirm
    );

    if (!permission.allowed) {
      return permission.reason ?? "Permission denied.";
    }

    try {
      if (stageAll) {
        await runGitOrThrow(repoPath, ["add", "-A"]);
      }
      return await runGitOrThrow(repoPath, ["commit", "-m", message]);
    } catch (error) {
      const err = error as Error & { stdout?: string; stderr?: string; code?: number };
      return trimGitOutput(
        [
          `git commit failed${typeof err.code === "number" ? ` with exit code ${err.code}` : ""}.`,
          err.stdout,
          err.stderr,
          !err.stdout && !err.stderr && err.message
        ]
          .filter(Boolean)
          .join("\n")
      );
    }
  }
};
