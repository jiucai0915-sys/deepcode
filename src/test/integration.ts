import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ChangeTracker } from "../agent/change-tracker.js";
import { buildProjectTree } from "../project/tree.js";
import { PermissionManager } from "../security/permissions.js";
import { createDefaultToolRegistry } from "../tools/index.js";

const execFileAsync = promisify(execFile);

export async function runIntegrationTests() {
  const registry = createDefaultToolRegistry();
  const permissions = new PermissionManager();
  const changeTracker = new ChangeTracker();
  const scratchDir = ".deepcode-integration";
  const scratchFile = path.join(scratchDir, "hello.txt");

  async function execute(name: string, args: Record<string, unknown>) {
    return registry.execute(name, JSON.stringify(args), {
      confirm: async () => true,
      permissions,
      changeTracker
    });
  }

  await fs.rm(scratchDir, { recursive: true, force: true });
  await fs.mkdir(path.join(scratchDir, "ignored-by-deepcodeignore"), { recursive: true });
  await fs.writeFile(
    path.join(scratchDir, "ignored-by-deepcodeignore", "hidden.txt"),
    "hidden deepseek marker\n",
    "utf8"
  );

  console.log(await execute("write_file", {
    file_path: scratchFile,
    content: "hello world\n"
  }));

  assert.match(await execute("read_file", { file_path: scratchFile }), /hello world/);

  console.log(await execute("edit_file", {
    file_path: scratchFile,
    old_text: "hello world",
    new_text: "hello deepseek"
  }));

  console.log(await execute("multi_edit", {
    file_path: scratchFile,
    edits: [
      { old_text: "hello", new_text: "hi" },
      { old_text: "deepseek", new_text: "DeepCode" }
    ]
  }));

  const multiEdited = await execute("read_file", { file_path: scratchFile });
  assert.match(multiEdited, /hi DeepCode/);
  console.log(multiEdited);

  const undoResult = await changeTracker.undoLast();
  assert.match(undoResult, /restored/);
  const restored = await execute("read_file", { file_path: scratchFile });
  assert.match(restored, /hello deepseek/);
  console.log(`integration undo: ${undoResult}`);

  console.log(await execute("list_directory", {
    dir_path: scratchDir,
    max_depth: 2
  }));

  const searchResult = await execute("search_files", {
    dir_path: scratchDir,
    pattern: "deepseek"
  });
  assert.match(searchResult, /hello\.txt:1/);
  assert.equal(searchResult.includes("hidden.txt"), false);
  console.log(searchResult);

  const filenameSearch = await execute("search_filenames", {
    dir_path: scratchDir,
    pattern: "hello\\.txt"
  });
  assert.match(filenameSearch, /hello\.txt/);
  console.log(filenameSearch);

  const hiddenFilenameSearch = await execute("search_filenames", {
    dir_path: scratchDir,
    pattern: "hidden\\.txt"
  });
  assert.equal(hiddenFilenameSearch.includes("hidden.txt"), false);
  console.log(`integration ignore: ${hiddenFilenameSearch}`);

  const treeSnapshot = await buildProjectTree({ maxDepth: 2, maxEntries: 80 });
  assert.equal(treeSnapshot.includes("node_modules"), false);
  assert.equal(treeSnapshot.includes("dist/"), false);
  console.log("integration context tree: ignored heavy folders");

  await assertGitTools(execute, scratchDir);

  console.log(await execute("run_command", {
    command: "node --version"
  }));

  const denied = await execute("run_command", {
    command: "rm -rf /"
  });
  assert.match(denied, /rejected/);
  console.log(denied);

  await fs.rm(scratchDir, { recursive: true, force: true });
}

async function assertGitTools(
  execute: (name: string, args: Record<string, unknown>) => Promise<string>,
  scratchDir: string
) {
  const repoDir = path.join(scratchDir, "repo");
  await fs.mkdir(repoDir, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: repoDir, windowsHide: true });
  await execFileAsync("git", ["config", "user.email", "deepcode@example.test"], { cwd: repoDir, windowsHide: true });
  await execFileAsync("git", ["config", "user.name", "DeepCode Smoke"], { cwd: repoDir, windowsHide: true });
  await fs.writeFile(path.join(repoDir, "tracked.txt"), "before\n", "utf8");
  await execFileAsync("git", ["add", "tracked.txt"], { cwd: repoDir, windowsHide: true });
  await fs.writeFile(path.join(repoDir, "tracked.txt"), "after\n", "utf8");

  const gitStatus = await execute("git_status", { repo_path: repoDir });
  assert.match(gitStatus, /tracked\.txt/);
  console.log(gitStatus);

  const gitDiff = await execute("git_diff", { repo_path: repoDir });
  assert.match(gitDiff, /-before/);
  assert.match(gitDiff, /\+after/);
  console.log(gitDiff);

  const gitCommit = await execute("git_commit", {
    repo_path: repoDir,
    message: "test: smoke commit",
    all: true
  });
  assert.ok(gitCommit.includes("test: smoke commit") || gitCommit.includes("1 file changed"));
  console.log(gitCommit);

  const gitLog = await execute("git_log", {
    repo_path: repoDir,
    max_count: 1
  });
  assert.match(gitLog, /test: smoke commit/);
  console.log(gitLog);
}

runIntegrationTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
