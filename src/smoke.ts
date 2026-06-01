import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ChangeTracker } from "./agent/change-tracker.js";
import { compressConversation, CONVERSATION_SUMMARY_PREFIX } from "./agent/compressor.js";
import { SessionStore } from "./agent/session.js";
import { extractYamlFrontMatter, loadConfig, parseSimpleYaml, readProjectConfig, stripYamlFrontMatter } from "./config/defaults.js";
import { calculateV4FlashCost, formatCny } from "./llm/cost.js";
import type { Message } from "./llm/types.js";
import { buildProjectTree } from "./project/tree.js";
import { initProjectNotes } from "./project/init.js";
import { PermissionManager } from "./security/permissions.js";
import { createDefaultToolRegistry } from "./tools/index.js";

const registry = createDefaultToolRegistry();
const permissions = new PermissionManager();
const changeTracker = new ChangeTracker();
const scratchDir = ".deepcode-smoke";
const scratchFile = path.join(scratchDir, "hello.txt");
const execFileAsync = promisify(execFile);

async function execute(name: string, args: Record<string, unknown>) {
  return registry.execute(name, JSON.stringify(args), {
    confirm: async () => true,
    permissions,
    changeTracker
  });
}

async function main() {
  await fs.rm(scratchDir, { recursive: true, force: true });
  await fs.mkdir(path.join(scratchDir, "ignored-by-deepcodeignore"), { recursive: true });
  await fs.writeFile(
    path.join(scratchDir, "ignored-by-deepcodeignore", "hidden.txt"),
    "hidden deepseek marker\n",
    "utf8"
  );

  const toolNames = registry.getDefinitions().map((definition) => definition.name);
  const sortedToolNames = [...toolNames].sort((a, b) => a.localeCompare(b));
  if (toolNames.join(",") !== sortedToolNames.join(",")) {
    throw new Error("tool definitions are not stable-sorted");
  }
  console.log(`tool order smoke: ${toolNames.join(", ")}`);

  console.log(await execute("write_file", {
    file_path: scratchFile,
    content: "hello world\n"
  }));

  console.log(await execute("read_file", {
    file_path: scratchFile
  }));

  console.log(await execute("edit_file", {
    file_path: scratchFile,
    old_text: "hello world",
    new_text: "hello deepseek"
  }));

  console.log(await execute("multi_edit", {
    file_path: scratchFile,
    edits: [
      {
        old_text: "hello",
        new_text: "hi"
      },
      {
        old_text: "deepseek",
        new_text: "DeepCode"
      }
    ]
  }));

  const multiEdited = await execute("read_file", {
    file_path: scratchFile
  });
  if (!multiEdited.includes("hi DeepCode")) {
    throw new Error("multi_edit did not apply expected replacements");
  }
  console.log(multiEdited);

  const undoResult = await changeTracker.undoLast();
  if (!undoResult.includes("restored")) {
    throw new Error("undo edit failed");
  }
  const restored = await execute("read_file", {
    file_path: scratchFile
  });
  if (!restored.includes("hello deepseek")) {
    throw new Error("undo did not restore previous content");
  }
  console.log(`undo smoke: ${undoResult}`);

  console.log(await execute("list_directory", {
    dir_path: scratchDir,
    max_depth: 2
  }));

  const searchResult = await execute("search_files", {
    dir_path: scratchDir,
    pattern: "deepseek"
  });
  if (!searchResult.includes("hello.txt:1") || searchResult.includes("hidden.txt")) {
    throw new Error("search_files did not find expected match");
  }
  console.log(searchResult);

  const filenameSearch = await execute("search_filenames", {
    dir_path: scratchDir,
    pattern: "hello\\.txt"
  });
  if (!filenameSearch.includes("hello.txt")) {
    throw new Error("search_filenames did not find expected file");
  }
  console.log(filenameSearch);

  const hiddenFilenameSearch = await execute("search_filenames", {
    dir_path: scratchDir,
    pattern: "hidden\\.txt"
  });
  if (hiddenFilenameSearch.includes("hidden.txt")) {
    throw new Error("search_filenames did not respect .deepcodeignore");
  }
  console.log(`ignore smoke: ${hiddenFilenameSearch}`);

  const treeSnapshot = await buildProjectTree({ maxDepth: 2, maxEntries: 80 });
  if (treeSnapshot.includes("node_modules") || treeSnapshot.includes("dist/")) {
    throw new Error("project tree did not respect .deepcodeignore");
  }
  console.log("context tree smoke: ignored heavy folders");

  const repoDir = path.join(scratchDir, "repo");
  await fs.mkdir(repoDir, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: repoDir, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "deepcode@example.test"], { cwd: repoDir, windowsHide: true });
  await execFileAsync("git", ["config", "user.name", "DeepCode Smoke"], { cwd: repoDir, windowsHide: true });
  await fs.writeFile(path.join(repoDir, "tracked.txt"), "before\n", "utf8");
  await execFileAsync("git", ["add", "tracked.txt"], { cwd: repoDir, windowsHide: true });
  await fs.writeFile(path.join(repoDir, "tracked.txt"), "after\n", "utf8");

  const gitStatus = await execute("git_status", {
    repo_path: repoDir
  });
  if (!gitStatus.includes("tracked.txt")) {
    throw new Error("git_status did not show expected file");
  }
  console.log(gitStatus);

  const gitDiff = await execute("git_diff", {
    repo_path: repoDir
  });
  if (!gitDiff.includes("-before") || !gitDiff.includes("+after")) {
    throw new Error("git_diff did not show expected diff");
  }
  console.log(gitDiff);

  const gitCommit = await execute("git_commit", {
    repo_path: repoDir,
    message: "test: smoke commit",
    all: true
  });
  if (!gitCommit.includes("test: smoke commit") && !gitCommit.includes("1 file changed")) {
    throw new Error("git_commit did not commit expected change");
  }
  console.log(gitCommit);

  const gitLog = await execute("git_log", {
    repo_path: repoDir,
    max_count: 1
  });
  if (!gitLog.includes("test: smoke commit")) {
    throw new Error("git_log did not show expected commit");
  }
  console.log(gitLog);

  console.log(await execute("run_command", {
    command: "node --version"
  }));

  const denied = await execute("run_command", {
    command: "rm -rf /"
  });
  if (!denied.includes("rejected")) {
    throw new Error("dangerous command was not rejected");
  }
  console.log(denied);

  const permissionSmoke = new PermissionManager(["node"]);
  let confirmationCount = 0;
  const approve = async () => {
    confirmationCount++;
    return true;
  };
  await permissionSmoke.authorize({ level: 2, category: "edit_file", description: "edit once" }, approve);
  await permissionSmoke.authorize({ level: 2, category: "edit_file", description: "edit twice" }, approve);
  await permissionSmoke.authorize({ level: 3, category: "run_command", description: "run once" }, approve);
  await permissionSmoke.authorize({ level: 3, category: "run_command", description: "run twice" }, approve);
  const rejected = await permissionSmoke.authorize(
    { level: 4, category: "danger", description: "danger" },
    approve
  );
  if (confirmationCount !== 3 || rejected.allowed || permissionSmoke.classifyCommand("node --version") !== 1 || permissionSmoke.classifyCommand("echo hi") !== 3 || permissionSmoke.classifyCommand("rm -rf /") !== 4) {
    throw new Error("permission levels failed");
  }
  console.log("permission smoke: levels 1-4 passed");

  const cost = calculateV4FlashCost({
    promptCacheHitTokens: 1000,
    promptCacheMissTokens: 2000,
    completionTokens: 3000
  });
  if (cost.cny <= 0) {
    throw new Error("cost calculation failed");
  }
  console.log(`cost smoke: ${formatCny(cost.cny)}`);

  const longHistory: Message[] = [
    { role: "system", content: "system" },
    ...Array.from({ length: 8 }, (_, index): Message[] => [
      { role: "user", content: `user ${index} ${"x".repeat(300)}` },
      { role: "assistant", content: `assistant ${index}` }
    ]).flat()
  ];
  const compressed = await compressConversation(longHistory, {
    baseMessageCount: 1,
    thresholdTokens: 100,
    recentTurnsToKeep: 3,
    summarize: async () =>
      "User goal: smoke\nCompleted actions: compressed\nCurrent file state: none\nOpen issues: none"
  });
  if (!compressed.compressed || !compressed.history[1]?.content?.startsWith(CONVERSATION_SUMMARY_PREFIX)) {
    throw new Error("conversation compression did not create summary");
  }
  const preservedUsers = compressed.history.filter((message) => message.role === "user");
  if (preservedUsers.length !== 3 || !preservedUsers[0].content?.startsWith("user 5")) {
    throw new Error("conversation compression did not preserve recent 3 turns");
  }
  console.log(`compression smoke: ${compressed.beforeTokens} -> ${compressed.afterTokens}`);

  const configDir = path.join(scratchDir, "config-project");
  await fs.mkdir(configDir, { recursive: true });
  const projectFile = [
    "---",
    "model: pro",
    "thinking: true",
    "maxToolRounds: 12",
    "commandWhitelist:",
    "  - node",
    "  - pnpm",
    "---",
    "# Project",
    "Context body"
  ].join("\n");
  await fs.writeFile(path.join(configDir, "DEEPCODE.md"), projectFile, "utf8");
  const projectConfig = await readProjectConfig(configDir);
  const loadedConfig = await loadConfig({
    cwd: configDir,
    globalConfig: {
      apiKey: "sk-global",
      model: "flash",
      maxToolRounds: 3
    },
    cli: {
      model: "flash"
    }
  });
  if (
    projectConfig.model !== "pro" ||
    loadedConfig.llm.apiKey !== "sk-global" ||
    loadedConfig.llm.model !== "deepseek-v4-flash" ||
    loadedConfig.llm.thinking !== true ||
    loadedConfig.maxToolRounds !== 12 ||
    loadedConfig.commandWhitelist.join(",") !== "node,pnpm"
  ) {
    throw new Error("layered config merge failed");
  }
  const frontMatter = extractYamlFrontMatter(projectFile);
  if (!frontMatter || parseSimpleYaml(frontMatter).model !== "pro") {
    throw new Error("front matter parser failed");
  }
  if (stripYamlFrontMatter(projectFile).includes("model: pro")) {
    throw new Error("front matter was not stripped from project context");
  }
  console.log("config smoke: cli > project > global passed");

  const sessionRoot = path.join(scratchDir, "session-project");
  const firstStore = new SessionStore(sessionRoot, new Date("2026-06-01T01:00:00.000Z"));
  await firstStore.save([
    { role: "system", content: "system" },
    { role: "user", content: "first" }
  ], "deepseek-v4-flash");
  const secondStore = new SessionStore(sessionRoot, new Date("2026-06-01T02:00:00.000Z"));
  await secondStore.save([
    { role: "system", content: "system" },
    { role: "user", content: "second" }
  ], "deepseek-v4-flash");
  const recentSessions = await secondStore.listRecent(10);
  const resumedSession = await secondStore.loadLatest();
  if (recentSessions.length !== 2 || resumedSession?.history[1]?.content !== "first") {
    throw new Error("session persistence failed");
  }
  console.log(`session smoke: ${recentSessions.length} sessions, resumed ${resumedSession.id}`);

  const initDir = path.join(scratchDir, "init-project");
  await fs.mkdir(initDir, { recursive: true });
  await fs.writeFile(
    path.join(initDir, "package.json"),
    JSON.stringify({
      name: "init-smoke",
      scripts: {
        build: "tsup",
        test: "node test.js"
      },
      dependencies: {
        chalk: "^5.0.0"
      }
    }),
    "utf8"
  );
  const initResult = await initProjectNotes({ cwd: initDir });
  const initContent = await fs.readFile(path.join(initDir, "DEEPCODE.md"), "utf8");
  const noOverwrite = await initProjectNotes({ cwd: initDir });
  const forceOverwrite = await initProjectNotes({ cwd: initDir, force: true });
  if (
    !initResult.created ||
    noOverwrite.created ||
    !forceOverwrite.created ||
    !initContent.includes("Name: init-smoke") ||
    !initContent.includes("pnpm build") ||
    !initContent.includes("chalk")
  ) {
    throw new Error("DEEPCODE.md init template failed");
  }
  console.log("init smoke: DEEPCODE.md template generated");

  await fs.rm(scratchDir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
