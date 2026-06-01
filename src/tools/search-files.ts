import fs from "node:fs/promises";
import path from "node:path";
import { loadIgnoreMatcher, type IgnoreMatcher } from "../project/ignore.js";
import { isDangerousPath } from "../security/permissions.js";
import { isInsideWorkspace, resolveWorkspacePath, toRelativePath } from "../security/workspace.js";
import { optionalNumber } from "./path-args.js";
import type { ToolExecutor } from "./registry.js";

const MAX_FILE_SIZE_BYTES = 1024 * 1024;

interface SearchMatch {
  filePath: string;
  lineNumber: number;
  line: string;
}

async function collectFiles(dirPath: string, matcher: IgnoreMatcher, files: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (matcher.isIgnored(entryPath)) continue;

    if (entry.isDirectory()) {
      await collectFiles(entryPath, matcher, files);
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function searchFile(filePath: string, pattern: RegExp, matches: SearchMatch[], maxResults: number) {
  const stats = await fs.stat(filePath);
  if (stats.size > MAX_FILE_SIZE_BYTES) return;

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return;
  }

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    pattern.lastIndex = 0;
    if (pattern.test(lines[index])) {
      matches.push({
        filePath,
        lineNumber: index + 1,
        line: lines[index]
      });
      if (matches.length >= maxResults) return;
    }
  }
}

export const searchFilesTool: ToolExecutor = {
  definition: {
    name: "search_files",
    description: "Search file contents with a regular expression inside the current workspace.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "JavaScript regular expression pattern to search for."
        },
        dir_path: {
          type: "string",
          description: "Directory to search, relative to the current workspace. Defaults to current workspace."
        },
        max_results: {
          type: "number",
          description: "Maximum matches to return. Defaults to 100."
        }
      },
      required: ["pattern"]
    }
  },

  async execute(args) {
    const patternValue = args.pattern;
    if (typeof patternValue !== "string" || !patternValue) {
      throw new Error('missing required string argument "pattern"');
    }

    const dirInput = typeof args.dir_path === "string" && args.dir_path ? args.dir_path : ".";
    const maxResults = Math.max(1, Math.min(optionalNumber(args, "max_results", 100), 500));
    const dirPath = resolveWorkspacePath(dirInput);

    if (!isInsideWorkspace(dirPath) || isDangerousPath(dirPath)) {
      return "Error: search_files is limited to directories inside the current workspace.";
    }

    const pattern = new RegExp(patternValue);
    const matcher = await loadIgnoreMatcher();
    const files = await collectFiles(dirPath, matcher);
    const matches: SearchMatch[] = [];

    for (const filePath of files) {
      await searchFile(filePath, pattern, matches, maxResults);
      if (matches.length >= maxResults) break;
    }

    if (matches.length === 0) {
      return "No matches found.";
    }

    return matches
      .map((match) => `${toRelativePath(match.filePath)}:${match.lineNumber}: ${match.line}`)
      .join("\n");
  }
};
