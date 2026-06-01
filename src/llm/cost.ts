import type { TokenUsage } from "./types.js";

const USD_TO_CNY = Number(process.env.DEEPCODE_USD_TO_CNY ?? 7.25);

const V4_FLASH_USD_PER_MILLION = {
  promptCacheHit: 0.0028,
  promptCacheMiss: 0.14,
  completion: 0.28
};

export interface CostSummary {
  cny: number;
}

export function calculateV4FlashCost(usage: TokenUsage): CostSummary {
  const usd =
    (usage.promptCacheHitTokens / 1_000_000) * V4_FLASH_USD_PER_MILLION.promptCacheHit +
    (usage.promptCacheMissTokens / 1_000_000) * V4_FLASH_USD_PER_MILLION.promptCacheMiss +
    (usage.completionTokens / 1_000_000) * V4_FLASH_USD_PER_MILLION.completion;

  return {
    cny: usd * USD_TO_CNY
  };
}

export function formatCny(value: number): string {
  return `¥${value.toFixed(6)}`;
}
