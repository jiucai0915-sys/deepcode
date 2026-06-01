import fs from "node:fs/promises";
import path from "node:path";
import { stripYamlFrontMatter } from "../config/defaults.js";

const PROJECT_CONTEXT_FILES = ["DEEPCODE.md", "deepcode.md"];

export async function loadProjectContext(cwd = process.cwd()): Promise<string | null> {
  for (const fileName of PROJECT_CONTEXT_FILES) {
    const filePath = path.join(cwd, fileName);
    try {
      const content = await fs.readFile(filePath, "utf8");
      return `Project context from ${fileName}:\n${stripYamlFrontMatter(content)}`;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  return null;
}
