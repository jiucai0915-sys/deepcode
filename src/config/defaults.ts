import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Interface as ReadlineInterface } from "node:readline/promises";
import { DEFAULT_COMPRESSION_THRESHOLD_TOKENS } from "../agent/compressor.js";
import { DEFAULT_LLM_CONFIG, type LLMConfig } from "../llm/types.js";
import { DEFAULT_COMMAND_WHITELIST } from "../security/permissions.js";

export interface UserConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  thinking?: boolean;
  maxTokens?: number;
  maxToolRounds?: number;
  compressionThresholdTokens?: number;
  commandWhitelist?: string[];
}

export interface CliConfigOverrides {
  model?: string;
  think?: boolean;
}

export interface DeepCodeConfig {
  llm: LLMConfig;
  maxToolRounds: number;
  compressionThresholdTokens: number;
  commandWhitelist: string[];
}

export function getGlobalConfigPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".deepcode", "config.json");
}

export async function readGlobalConfig(homeDir = os.homedir()): Promise<UserConfig | null> {
  try {
    const content = await fs.readFile(getGlobalConfigPath(homeDir), "utf8");
    return JSON.parse(content) as UserConfig;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

export async function writeGlobalConfig(config: UserConfig, homeDir = os.homedir()): Promise<void> {
  const configPath = getGlobalConfigPath(homeDir);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function ensureGlobalConfig(rl: ReadlineInterface, homeDir = os.homedir()): Promise<UserConfig> {
  const existing = await readGlobalConfig(homeDir);
  if (existing?.apiKey) {
    return existing;
  }

  const apiKey = (await rl.question("DeepSeek API Key: ")).trim();
  const config: UserConfig = {
    ...(existing ?? {}),
    apiKey,
    model: existing?.model ?? "deepseek-v4-flash",
    baseURL: existing?.baseURL ?? "https://api.deepseek.com"
  };
  await writeGlobalConfig(config, homeDir);
  return config;
}

export async function readProjectConfig(cwd = process.cwd()): Promise<UserConfig> {
  const filePath = path.join(cwd, "DEEPCODE.md");
  try {
    const content = await fs.readFile(filePath, "utf8");
    const frontMatter = extractYamlFrontMatter(content);
    return frontMatter ? parseSimpleYaml(frontMatter) : {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    throw error;
  }
}

export async function loadConfig(options?: {
  cli?: CliConfigOverrides;
  homeDir?: string;
  cwd?: string;
  globalConfig?: UserConfig;
  projectConfig?: UserConfig;
}): Promise<DeepCodeConfig> {
  const globalConfig = options?.globalConfig ?? (await readGlobalConfig(options?.homeDir));
  const projectConfig = options?.projectConfig ?? (await readProjectConfig(options?.cwd));
  const cliConfig: UserConfig = {
    model: options?.cli?.model,
    thinking: options?.cli?.think
  };
  const merged = mergeUserConfigs(globalConfig ?? {}, projectConfig, cliConfig);

  return {
    llm: {
      ...DEFAULT_LLM_CONFIG,
      apiKey: merged.apiKey ?? "",
      baseURL: merged.baseURL ?? DEFAULT_LLM_CONFIG.baseURL,
      model: normalizeModel(merged.model ?? DEFAULT_LLM_CONFIG.model),
      thinking: merged.thinking ?? DEFAULT_LLM_CONFIG.thinking,
      maxTokens: merged.maxTokens ?? DEFAULT_LLM_CONFIG.maxTokens
    },
    maxToolRounds: merged.maxToolRounds ?? 8,
    compressionThresholdTokens:
      merged.compressionThresholdTokens ?? DEFAULT_COMPRESSION_THRESHOLD_TOKENS,
    commandWhitelist: merged.commandWhitelist ?? DEFAULT_COMMAND_WHITELIST
  };
}

export function mergeUserConfigs(...configs: UserConfig[]): UserConfig {
  return configs.reduce<UserConfig>((merged, config) => ({
    ...merged,
    ...dropUndefined(config)
  }), {});
}

export function extractYamlFrontMatter(content: string): string | null {
  if (!content.startsWith("---")) return null;
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return match?.[1] ?? null;
}

export function stripYamlFrontMatter(content: string): string {
  if (!content.startsWith("---")) return content;
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

export function parseSimpleYaml(yaml: string): UserConfig {
  const result: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);
  let currentArrayKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (currentArrayKey && line.startsWith("- ")) {
      (result[currentArrayKey] as string[]).push(line.slice(2).trim());
      continue;
    }

    currentArrayKey = null;
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!match) continue;

    const key = normalizeConfigKey(match[1]);
    const value = match[2].trim();
    if (!value) {
      result[key] = [];
      currentArrayKey = key;
      continue;
    }

    result[key] = parseYamlScalar(value);
  }

  return result as UserConfig;
}

function parseYamlScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value.replace(/^["']|["']$/g, "");
}

function normalizeConfigKey(key: string): string {
  const aliases: Record<string, string> = {
    think: "thinking",
    "max-tool-rounds": "maxToolRounds",
    "max-tokens": "maxTokens",
    "compression-threshold-tokens": "compressionThresholdTokens",
    "command-whitelist": "commandWhitelist",
    "api-key": "apiKey",
    "base-url": "baseURL"
  };
  return aliases[key] ?? key;
}

function normalizeModel(model: string): string {
  if (model === "flash") return "deepseek-v4-flash";
  if (model === "pro") return "deepseek-v4-pro";
  return model;
}

function dropUndefined(config: UserConfig): UserConfig {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined)
  ) as UserConfig;
}
