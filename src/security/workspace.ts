import path from "node:path";

export function getWorkspaceRoot(): string {
  return process.cwd();
}

export function resolveWorkspacePath(inputPath: string): string {
  return path.resolve(getWorkspaceRoot(), inputPath);
}

export function isInsideWorkspace(inputPath: string): boolean {
  const root = path.resolve(getWorkspaceRoot());
  const target = path.resolve(inputPath);
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function toRelativePath(inputPath: string): string {
  return path.relative(getWorkspaceRoot(), inputPath) || ".";
}
