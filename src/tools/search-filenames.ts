import fs from "node:fs/promises";
import path from "node:path";
import { loadIgnoreMatcher, type IgnoreMatcher } from "../project/ignore.js";
import { isDangerousPath } from "../security/permissions.js";
import { isInsideWorkspace, resolveWorkspacePath, toRelativePath } from "../security/workspace.js";
import { optionalNumber } from "./path-args.js";
import type { ToolExecutor } from "./registry.js";

async function collectMatchingPaths(
  dirPath: string,
  pattern: RegExp,
  maxResults: number,
  matcher: IgnoreMatcher,
  results: string[] = []
): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (results.length >= maxResults) break;

    const entryPath = path.join(dirPath, entry.name);
    if (matcher.isIgnored(entryPath)) continue;

    const relativePath = toRelativePath(entryPath).replaceAll("\\", "/");

    pattern.lastIndex = 0;
    if (pattern.test(entry.name) || pattern.test(relativePath)) {
      results.push(entryPath);
    }

    if (entry.isDirectory()) {
      await collectMatchingPaths(entryPath, pattern, maxResults, matcher, results);
    }
  }

  return results;
}

export const searchFilenamesTool: ToolExecutor = {
  definition: {
    name: "search_filenames",
    description: "Search file and directory names with a regular expression inside the current workspace.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "JavaScript regular expression pattern to match against names or relative paths."
        },
        dir_path: {
          type: "string",
          description: "Directory to search, relative to the current workspace. Defaults to current workspace."
        },
        max_results: {
          type: "number",
          description: "Maximum paths to return. Defaults to 100."
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
      return "Error: search_filenames is limited to directories inside the current workspace.";
    }

    const pattern = new RegExp(patternValue);
    const matcher = await loadIgnoreMatcher();
    const matches = await collectMatchingPaths(dirPath, pattern, maxResults, matcher);

    if (matches.length === 0) {
      return "No matching filenames found.";
    }

    return matches.map((match) => toRelativePath(match)).join("\n");
  }
};
