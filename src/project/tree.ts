import fs from "node:fs/promises";
import path from "node:path";
import { getWorkspaceRoot, toRelativePath } from "../security/workspace.js";
import { loadIgnoreMatcher, type IgnoreMatcher } from "./ignore.js";

export interface ProjectTreeOptions {
  cwd?: string;
  maxDepth?: number;
  maxEntries?: number;
}

export async function buildProjectTree(options: ProjectTreeOptions = {}): Promise<string> {
  const cwd = options.cwd ?? getWorkspaceRoot();
  const matcher = await loadIgnoreMatcher(cwd);
  const state = {
    count: 0,
    maxEntries: options.maxEntries ?? 200
  };
  const lines = await walk(cwd, options.maxDepth ?? 3, "", state, matcher);
  return `${toRelativePath(cwd)}/\n${lines.join("\n")}`;
}

async function walk(
  dirPath: string,
  depth: number,
  prefix: string,
  state: { count: number; maxEntries: number },
  matcher: IgnoreMatcher
): Promise<string[]> {
  if (depth < 0 || state.count >= state.maxEntries) return [];

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const visible = entries
    .map((entry) => ({ entry, entryPath: path.join(dirPath, entry.name) }))
    .filter(({ entryPath }) => !matcher.isIgnored(entryPath))
    .sort((a, b) => Number(b.entry.isDirectory()) - Number(a.entry.isDirectory()) || a.entry.name.localeCompare(b.entry.name));

  const lines: string[] = [];
  for (const { entry, entryPath } of visible) {
    if (state.count >= state.maxEntries) {
      lines.push(`${prefix}... [truncated]`);
      break;
    }

    state.count++;
    lines.push(`${prefix}${entry.name}${entry.isDirectory() ? "/" : ""}`);

    if (entry.isDirectory()) {
      lines.push(...(await walk(entryPath, depth - 1, `${prefix}  `, state, matcher)));
    }
  }

  return lines;
}
