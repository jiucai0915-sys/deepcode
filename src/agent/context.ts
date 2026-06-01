import fs from "node:fs/promises";
import path from "node:path";
import { stripYamlFrontMatter } from "../config/defaults.js";
import { buildProjectTree } from "../project/tree.js";

const PROJECT_CONTEXT_FILES = ["DEEPCODE.md", "deepcode.md"];

export interface ProjectContextResult {
  content: string;
  source: string;
}

export async function loadProjectContext(cwd = process.cwd()): Promise<ProjectContextResult> {
  const sections: string[] = [];
  const sources: string[] = [];

  for (const fileName of PROJECT_CONTEXT_FILES) {
    const filePath = path.join(cwd, fileName);
    try {
      const content = await fs.readFile(filePath, "utf8");
      sections.push(`Project context from ${fileName}:\n${stripYamlFrontMatter(content)}`);
      sources.push(fileName);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  const tree = await buildProjectTree({ cwd, maxDepth: 3, maxEntries: 200 });
  sections.push(`Current project tree snapshot:\n${tree}`);
  sources.push("project-tree");

  return {
    content: sections.join("\n\n"),
    source: sources.join(", ")
  };
}
