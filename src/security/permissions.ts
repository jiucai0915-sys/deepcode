export type PermissionLevel = 1 | 2 | 3 | 4;

export const DEFAULT_COMMAND_WHITELIST = [
  "node",
  "npm",
  "pnpm",
  "npx",
  "tsc",
  "git status",
  "git diff",
  "git log",
  "git branch",
  "dir",
  "ls",
  "cat",
  "type"
];

export interface PermissionRequest {
  level: PermissionLevel;
  category: string;
  description: string;
}

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

const forbiddenCommandPatterns = [
  /\brm\s+-rf\b/i,
  /\bformat\b/i,
  /\bdel\s+\/s\b/i,
  /\bdel\s+\/[fsq]/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bdiskpart\b/i,
  />\s*(?:[a-z]:\\|\/)\s*$/i
];

export class PermissionManager {
  private readonly approvedLevel2Categories = new Set<string>();

  constructor(private readonly commandWhitelist = DEFAULT_COMMAND_WHITELIST) {}

  async authorize(
    request: PermissionRequest,
    confirm: (message: string) => Promise<boolean>
  ): Promise<PermissionResult> {
    if (request.level === 4) {
      return {
        allowed: false,
        reason: `Rejected by Level 4 safety policy: ${request.description}`
      };
    }

    if (request.level === 1) {
      return { allowed: true };
    }

    if (request.level === 2 && this.approvedLevel2Categories.has(request.category)) {
      return { allowed: true };
    }

    const approved = await confirm(formatPermissionPrompt(request));
    if (!approved) {
      return {
        allowed: false,
        reason: "Cancelled by user."
      };
    }

    if (request.level === 2) {
      this.approvedLevel2Categories.add(request.category);
    }

    return { allowed: true };
  }

  classifyCommand(command: string): PermissionLevel {
    return classifyCommand(command, this.commandWhitelist);
  }
}

export function classifyCommand(
  command: string,
  commandWhitelist = DEFAULT_COMMAND_WHITELIST
): PermissionLevel {
  const trimmed = command.trim();

  if (!trimmed) return 4;
  if (forbiddenCommandPatterns.some((pattern) => pattern.test(trimmed))) {
    return 4;
  }

  if (isWhitelistedCommand(trimmed, commandWhitelist)) {
    return 1;
  }

  return 3;
}

export function isDangerousPath(pathValue: string): boolean {
  const normalized = pathValue.replaceAll("/", "\\").toLowerCase();
  return (
    normalized.startsWith("c:\\windows") ||
    normalized.startsWith("c:\\program files") ||
    normalized.startsWith("c:\\program files (x86)") ||
    normalized.includes("\\system32")
  );
}

function isWhitelistedCommand(command: string, commandWhitelist: string[]): boolean {
  const normalized = command.toLowerCase();
  return commandWhitelist.some((entry) => {
    const allowed = entry.toLowerCase();
    return normalized === allowed || normalized.startsWith(`${allowed} `);
  });
}

function formatPermissionPrompt(request: PermissionRequest): string {
  const label = request.level === 2 ? "Level 2 first approval" : "Level 3 approval required";
  return `${label}: ${request.description}`;
}
