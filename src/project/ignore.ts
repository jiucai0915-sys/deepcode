import fs from "node:fs/promises";
import path from "node:path";
import { getWorkspaceRoot, toRelativePath } from "../security/workspace.js";

const DEFAULT_IGNORES = [
  "node_modules",
  "dist",
  ".git",
  ".deepcode",
  ".deepcode-demo",
  ".next",
  "coverage",
  ".turbo"
];

export interface IgnoreMatcher {
  isIgnored: (absolutePath: string) => boolean;
  patterns: string[];
}

export async function loadIgnoreMatcher(cwd = getWorkspaceRoot()): Promise<IgnoreMatcher> {
  const patterns = [...DEFAULT_IGNORES, ...(await readDeepCodeIgnore(cwd))];
  const uniquePatterns = Array.from(new Set(patterns.map((pattern) => normalizePattern(pattern))));

  return {
    patterns: uniquePatterns,
    isIgnored(absolutePath: string) {
      const relativePath = toRelativePath(absolutePath).replaceAll("\\", "/");
      const basename = path.basename(absolutePath);
      return uniquePatterns.some((pattern) => matchesPattern(relativePath, basename, pattern));
    }
  };
}

async function readDeepCodeIgnore(cwd: string): Promise<string[]> {
  try {
    const content = await fs.readFile(path.join(cwd, ".deepcodeignore"), "utf8");
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw error;
  }
}

function normalizePattern(pattern: string): string {
  return pattern.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function matchesPattern(relativePath: string, basename: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern.includes("*")) {
    return globToRegExp(pattern).test(relativePath) || globToRegExp(pattern).test(basename);
  }
  return (
    relativePath === pattern ||
    relativePath.startsWith(`${pattern}/`) ||
    basename === pattern
  );
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`);
}
