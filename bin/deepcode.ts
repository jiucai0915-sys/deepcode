#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ChangeTracker } from "../src/agent/change-tracker.js";
import { ConversationCompressor } from "../src/agent/compressor.js";
import { loadProjectContext } from "../src/agent/context.js";
import { AgentLoop } from "../src/agent/loop.js";
import { SYSTEM_PROMPT } from "../src/agent/prompt.js";
import { SessionStore } from "../src/agent/session.js";
import { ensureGlobalConfig, loadConfig } from "../src/config/defaults.js";
import { calculateV4FlashCost, formatCny } from "../src/llm/cost.js";
import { LLMClient } from "../src/llm/client.js";
import type { TokenUsage } from "../src/llm/types.js";
import { PermissionManager } from "../src/security/permissions.js";
import { createDefaultToolRegistry } from "../src/tools/index.js";
import { initProjectNotes } from "../src/project/init.js";

const program = new Command();

program
  .name("deepcode")
  .description("DeepSeek native terminal coding agent")
  .option("--model <model>", "DeepSeek model or alias (flash/pro)")
  .option("--think", "enable thinking mode")
  .option("--init", "create a DEEPCODE.md project notes template and exit")
  .option("--force", "overwrite DEEPCODE.md when used with --init")
  .parse();

const options = program.opts<{ model?: string; think?: boolean; init?: boolean; force?: boolean }>();

if (options.init) {
  const result = await initProjectNotes({ force: options.force });
  console.log(result.message);
  process.exit(result.created || !options.force ? 0 : 1);
}

const rl = readline.createInterface({ input, output });
const globalConfig = await ensureGlobalConfig(rl);
const config = await loadConfig({
  cli: {
    model: options.model,
    think: options.think
  },
  globalConfig
});

if (!config.llm.apiKey) {
  console.error(chalk.red("Missing API key. Run DeepCode again and enter your DeepSeek API Key."));
  process.exit(1);
}

const llm = new LLMClient(config.llm);
const tools = createDefaultToolRegistry();
const permissions = new PermissionManager(config.commandWhitelist);
const changeTracker = new ChangeTracker();
const projectContext = await loadProjectContext();
const compressor = new ConversationCompressor({
  llm,
  thresholdTokens: config.compressionThresholdTokens
});
const sessions = new SessionStore();
let cumulativeCostCny = 0;

async function confirm(message: string): Promise<boolean> {
  console.log(chalk.yellow(`\n${message}`));
  const answer = await rl.question(chalk.yellow("Approve? [y/N] "));
  return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
}

const agent = new AgentLoop({
  llm,
  tools,
  systemPrompt: SYSTEM_PROMPT,
  projectContext: projectContext.content,
  compressor,
  permissions,
  changeTracker,
  maxToolRounds: config.maxToolRounds,
  onText: (text) => process.stdout.write(text),
  onReasoning: (text) => process.stdout.write(chalk.gray(text)),
  onToolCall: (name, args) => {
    console.log(chalk.cyan(`\n\n[tool] ${name} ${args}`));
  },
  onToolResult: (name, result) => {
    console.log(chalk.dim(`\n[result] ${name}\n${result}\n`));
  },
  onUsage: (usage: TokenUsage) => {
    const cost = calculateV4FlashCost(usage);
    cumulativeCostCny += cost.cny;
    console.log(
      chalk.dim(
        `\n[usage] cache hit ${usage.promptCacheHitTokens} / miss ${usage.promptCacheMissTokens} / output ${usage.completionTokens} tokens | cost ${formatCny(cost.cny)} | total ${formatCny(cumulativeCostCny)}`
      )
    );
  },
  onCompress: (beforeTokens, afterTokens) => {
    console.log(chalk.dim(`\n[context] compressed history ${beforeTokens} -> ${afterTokens} estimated tokens`));
  },
  onError: (error) => {
    console.error(chalk.red(`\nError: ${error.message}`));
  },
  onConfirm: confirm
});

function printBanner() {
  console.log(chalk.cyan(" ____                  ____          _      "));
  console.log(chalk.cyan("|  _ \\  ___  ___ _ __ / ___|___   __| | ___ "));
  console.log(chalk.cyan("| | | |/ _ \\/ _ \\ '_ \\ |   / _ \\ / _` |/ _ \\"));
  console.log(chalk.cyan("| |_| |  __/  __/ |_) | |__| (_) | (_| |  __/"));
  console.log(chalk.cyan("|____/ \\___|\\___| .__/ \\____\\___/ \\__,_|\\___|"));
  console.log(chalk.cyan("                 |_|"));
  console.log(`DeepSeek native coding agent | model: ${chalk.bold(llm.getConfig().model)} | /help\n`);
}

function printHelp() {
  console.log(`
/help             Show this help
/model flash      Use deepseek-v4-flash
/model pro        Use deepseek-v4-pro
/model <name>     Use an explicit model name
/think on|off     Toggle thinking mode
/history          Show the latest 10 saved sessions
/resume           Resume the latest saved session
/undo             Undo the last DeepCode file write/edit
/cost             Show cumulative token cost
/config           Show effective config without secrets
/tools            List available tools
/context          Show injected project context summary
/init             Create a DEEPCODE.md project notes template
/clear            Clear conversation history
/exit             Exit
`);
}

async function handleCommand(line: string): Promise<boolean> {
  if (line === "/exit" || line === "/quit") {
    return true;
  }

  if (line === "/help") {
    printHelp();
    return false;
  }

  if (line === "/clear") {
    agent.reset();
    await sessions.save(agent.getHistory(), llm.getConfig().model);
    console.log(chalk.dim("Conversation cleared."));
    return false;
  }

  if (line === "/history") {
    const recent = await sessions.listRecent(10);
    if (recent.length === 0) {
      console.log(chalk.dim("No saved sessions."));
      return false;
    }

    for (const session of recent) {
      console.log(`${session.updatedAt}  ${session.id}  ${session.messageCount} messages`);
    }
    return false;
  }

  if (line === "/resume") {
    const session = await sessions.loadLatest();
    if (!session) {
      console.log(chalk.dim("No saved session to resume."));
      return false;
    }

    agent.setHistory(session.history);
    console.log(chalk.dim(`Resumed session ${session.id} (${session.history.length} messages).`));
    await sessions.save(agent.getHistory(), llm.getConfig().model);
    return false;
  }

  if (line === "/undo") {
    const restorePoint = changeTracker.peek();
    if (!restorePoint) {
      console.log(chalk.dim("No DeepCode Git restore points to undo."));
      return false;
    }

    const approved = await confirm(`Undo Git restore point ${restorePoint.id} (${restorePoint.label})?`);
    if (!approved) {
      console.log(chalk.dim("Undo cancelled."));
      return false;
    }

    console.log(chalk.dim(await changeTracker.undoLast()));
    return false;
  }

  if (line === "/cost") {
    console.log(`Total token cost this session: ${formatCny(cumulativeCostCny)}`);
    return false;
  }

  if (line === "/config") {
    console.log(JSON.stringify({
      model: llm.getConfig().model,
      thinking: llm.getConfig().thinking,
      baseURL: llm.getConfig().baseURL,
      apiKey: maskSecret(llm.getConfig().apiKey),
      maxToolRounds: config.maxToolRounds,
      compressionThresholdTokens: config.compressionThresholdTokens,
      commandWhitelist: config.commandWhitelist
    }, null, 2));
    return false;
  }

  if (line === "/tools") {
    for (const tool of tools.getDefinitions()) {
      console.log(`${tool.name} - ${tool.description}`);
    }
    return false;
  }

  if (line === "/context") {
    console.log(`Context sources: ${projectContext.source}`);
    console.log(projectContext.content);
    return false;
  }

  if (line === "/init") {
    const result = await initProjectNotes();
    if (!result.created && result.message.includes("already exists")) {
      const approved = await confirm("DEEPCODE.md already exists. Overwrite it?");
      if (!approved) {
        console.log(chalk.dim("Project notes initialization cancelled."));
        return false;
      }

      const forced = await initProjectNotes({ force: true });
      console.log(chalk.dim(forced.message));
      return false;
    }

    console.log(chalk.dim(result.message));
    return false;
  }

  if (line.startsWith("/model")) {
    const model = line.split(/\s+/)[1];
    if (!model) {
      console.log(`Current model: ${llm.getConfig().model}`);
      return false;
    }
    llm.setModel(model);
    console.log(`Model set to ${llm.getConfig().model}.`);
    return false;
  }

  if (line.startsWith("/think")) {
    const value = line.split(/\s+/)[1] ?? "on";
    llm.setThinking(value !== "off");
    console.log(`Thinking mode ${llm.getConfig().thinking ? "on" : "off"}.`);
    return false;
  }

  return false;
}

printBanner();

while (true) {
  let line: string;
  try {
    line = (await rl.question(chalk.cyan("> "))).trim();
  } catch {
    // stdin reached EOF (Ctrl-D) or the stream was closed; exit cleanly.
    console.log();
    break;
  }
  if (!line) continue;

  if (line.startsWith("/")) {
    const shouldExit = await handleCommand(line);
    if (shouldExit) break;
    continue;
  }

  console.log();
  await agent.run(line);
  await sessions.save(agent.getHistory(), llm.getConfig().model);
  console.log("\n");
}

rl.close();

function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
