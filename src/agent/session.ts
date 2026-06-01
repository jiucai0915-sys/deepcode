import fs from "node:fs/promises";
import path from "node:path";
import type { Message } from "../llm/types.js";

export interface SessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  history: Message[];
  model?: string;
}

export interface SessionSummary {
  id: string;
  filePath: string;
  updatedAt: string;
  messageCount: number;
}

export class SessionStore {
  readonly sessionsDir: string;
  readonly currentSessionPath: string;
  readonly currentSessionId: string;
  private readonly createdAt: string;

  constructor(cwd = process.cwd(), now = new Date()) {
    this.sessionsDir = path.join(cwd, ".deepcode", "sessions");
    this.currentSessionId = toSessionId(now);
    this.currentSessionPath = path.join(this.sessionsDir, `${this.currentSessionId}.json`);
    this.createdAt = now.toISOString();
  }

  async save(history: Message[], model?: string): Promise<void> {
    const data: SessionData = {
      id: this.currentSessionId,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
      history,
      model
    };

    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.writeFile(this.currentSessionPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  async listRecent(limit = 10): Promise<SessionSummary[]> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    const entries = await fs.readdir(this.sessionsDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => path.join(this.sessionsDir, entry.name));

    const sessions = await Promise.all(files.map((filePath) => readSessionSummary(filePath)));
    return sessions
      .filter((summary): summary is SessionSummary => Boolean(summary))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async loadLatest(): Promise<SessionData | null> {
    const recent = await this.listRecent(20);
    const latest = recent.find((session) => session.filePath !== this.currentSessionPath) ?? recent[0];
    if (!latest) return null;
    return readSession(latest.filePath);
  }
}

async function readSessionSummary(filePath: string): Promise<SessionSummary | null> {
  try {
    const session = await readSession(filePath);
    return {
      id: session.id,
      filePath,
      updatedAt: session.updatedAt,
      messageCount: session.history.length
    };
  } catch {
    return null;
  }
}

async function readSession(filePath: string): Promise<SessionData> {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as SessionData;
}

function toSessionId(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}
