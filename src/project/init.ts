import fs from "node:fs/promises";
import path from "node:path";

export interface InitProjectNotesResult {
  created: boolean;
  filePath: string;
  message: string;
}

export async function initProjectNotes(options: {
  cwd?: string;
  force?: boolean;
} = {}): Promise<InitProjectNotesResult> {
  const cwd = options.cwd ?? process.cwd();
  const filePath = path.join(cwd, "DEEPCODE.md");
  const existing = await fileExists(filePath);

  if (existing && !options.force) {
    return {
      created: false,
      filePath,
      message: "DEEPCODE.md already exists. Use --force or confirm overwrite to regenerate it."
    };
  }

  const template = await createProjectNotesTemplate(cwd);
  await fs.writeFile(filePath, template, "utf8");

  return {
    created: true,
    filePath,
    message: `${existing ? "Regenerated" : "Created"} DEEPCODE.md.`
  };
}

export async function createProjectNotesTemplate(cwd = process.cwd()): Promise<string> {
  const packageInfo = await readPackageInfo(cwd);
  const scripts = Object.keys(packageInfo.scripts ?? {});
  const dependencies = [
    ...Object.keys(packageInfo.dependencies ?? {}),
    ...Object.keys(packageInfo.devDependencies ?? {})
  ].sort();

  return `---
model: flash
thinking: false
maxToolRounds: 8
commandWhitelist:
  - node
  - npm
  - pnpm
  - npx
  - tsc
  - git status
  - git diff
  - git log
  - git branch
---

# Project Notes

## Project

- Name: ${packageInfo.name ?? path.basename(cwd)}
- Purpose: Describe what this project does.

## Tech Stack

${dependencies.length > 0 ? dependencies.map((dependency) => `- ${dependency}`).join("\n") : "- Add the main frameworks, languages, and services here."}

## Common Commands

${scripts.length > 0 ? scripts.map((script) => `- \`pnpm ${script}\``).join("\n") : "- Add build, test, lint, and dev commands here."}

## Coding Rules

- Keep changes small and focused.
- Read files before editing them.
- Prefer existing project patterns over new abstractions.
- Run the most relevant validation command after changing code.

## Safety Notes

- Do not edit secrets or generated files unless explicitly requested.
- Do not run destructive commands.
- Respect .deepcodeignore.

## Testing Notes

- Add the expected test command and any setup steps here.
`;
}

async function readPackageInfo(cwd: string): Promise<Record<string, any>> {
  try {
    const content = await fs.readFile(path.join(cwd, "package.json"), "utf8");
    return JSON.parse(content) as Record<string, any>;
  } catch {
    return {};
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
