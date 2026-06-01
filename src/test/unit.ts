import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { compressConversation, CONVERSATION_SUMMARY_PREFIX } from "../agent/compressor.js";
import { SessionStore } from "../agent/session.js";
import {
  extractYamlFrontMatter,
  loadConfig,
  parseSimpleYaml,
  readProjectConfig,
  stripYamlFrontMatter
} from "../config/defaults.js";
import { calculateV4FlashCost, formatCny } from "../llm/cost.js";
import type { Message } from "../llm/types.js";
import { initProjectNotes } from "../project/init.js";
import { PermissionManager } from "../security/permissions.js";
import { createDefaultToolRegistry } from "../tools/index.js";

export async function runUnitTests() {
  assertToolOrder();
  await assertPermissionLevels();
  assertCostCalculation();
  await assertCompression();
  await assertLayeredConfig();
  await assertSessionPersistence();
  await assertProjectNotesInit();
}

function assertToolOrder() {
  const registry = createDefaultToolRegistry();
  const toolNames = registry.getDefinitions().map((definition) => definition.name);
  const sortedToolNames = [...toolNames].sort((a, b) => a.localeCompare(b));
  assert.equal(toolNames.join(","), sortedToolNames.join(","));
  console.log(`unit tool order: ${toolNames.join(", ")}`);
}

async function assertPermissionLevels() {
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

  assert.equal(confirmationCount, 3);
  assert.equal(rejected.allowed, false);
  assert.equal(permissionSmoke.classifyCommand("node --version"), 1);
  assert.equal(permissionSmoke.classifyCommand("echo hi"), 3);
  assert.equal(permissionSmoke.classifyCommand("rm -rf /"), 4);
  console.log("unit permissions: levels 1-4 passed");
}

function assertCostCalculation() {
  const cost = calculateV4FlashCost({
    promptCacheHitTokens: 1000,
    promptCacheMissTokens: 2000,
    completionTokens: 3000
  });
  assert.ok(cost.cny > 0);
  assert.match(formatCny(cost.cny), /^¥\d+\.\d{6}$/);
  console.log(`unit cost: ${formatCny(cost.cny)}`);
}

async function assertCompression() {
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
  assert.equal(compressed.compressed, true);
  assert.ok(compressed.history[1]?.content?.startsWith(CONVERSATION_SUMMARY_PREFIX));

  const preservedUsers = compressed.history.filter((message) => message.role === "user");
  assert.equal(preservedUsers.length, 3);
  assert.ok(preservedUsers[0].content?.startsWith("user 5"));
  console.log(`unit compression: ${compressed.beforeTokens} -> ${compressed.afterTokens}`);
}

async function assertLayeredConfig() {
  const scratchDir = ".deepcode-unit";
  const configDir = path.join(scratchDir, "config-project");
  await fs.rm(scratchDir, { recursive: true, force: true });
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

  assert.equal(projectConfig.model, "pro");
  assert.equal(loadedConfig.llm.apiKey, "sk-global");
  assert.equal(loadedConfig.llm.model, "deepseek-v4-flash");
  assert.equal(loadedConfig.llm.thinking, true);
  assert.equal(loadedConfig.maxToolRounds, 12);
  assert.equal(loadedConfig.commandWhitelist.join(","), "node,pnpm");

  const frontMatter = extractYamlFrontMatter(projectFile);
  assert.ok(frontMatter);
  assert.equal(parseSimpleYaml(frontMatter).model, "pro");
  assert.equal(stripYamlFrontMatter(projectFile).includes("model: pro"), false);

  await fs.rm(scratchDir, { recursive: true, force: true });
  console.log("unit config: cli > project > global passed");
}

async function assertSessionPersistence() {
  const scratchDir = ".deepcode-unit";
  const sessionRoot = path.join(scratchDir, "session-project");
  await fs.rm(scratchDir, { recursive: true, force: true });

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
  assert.equal(recentSessions.length, 2);
  assert.equal(resumedSession?.history[1]?.content, "first");

  await fs.rm(scratchDir, { recursive: true, force: true });
  console.log(`unit session: ${recentSessions.length} sessions, resumed ${resumedSession?.id}`);
}

async function assertProjectNotesInit() {
  const scratchDir = ".deepcode-unit";
  const initDir = path.join(scratchDir, "init-project");
  await fs.rm(scratchDir, { recursive: true, force: true });
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

  assert.equal(initResult.created, true);
  assert.equal(noOverwrite.created, false);
  assert.equal(forceOverwrite.created, true);
  assert.ok(initContent.includes("Name: init-smoke"));
  assert.ok(initContent.includes("pnpm build"));
  assert.ok(initContent.includes("chalk"));

  await fs.rm(scratchDir, { recursive: true, force: true });
  console.log("unit init: DEEPCODE.md template generated");
}

runUnitTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
