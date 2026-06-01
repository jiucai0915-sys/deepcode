import type { LLMClient } from "../llm/client.js";
import type { Message } from "../llm/types.js";
import { estimateHistoryTokens } from "./tokens.js";

export const DEFAULT_COMPRESSION_THRESHOLD_TOKENS = 80000;
export const CONVERSATION_SUMMARY_PREFIX = "Conversation summary:";

export interface CompressionResult {
  compressed: boolean;
  beforeTokens: number;
  afterTokens: number;
  history: Message[];
}

export interface ConversationCompressorOptions {
  llm: LLMClient;
  thresholdTokens?: number;
  recentTurnsToKeep?: number;
}

export class ConversationCompressor {
  private readonly thresholdTokens: number;
  private readonly recentTurnsToKeep: number;

  constructor(private readonly options: ConversationCompressorOptions) {
    this.thresholdTokens = options.thresholdTokens ?? DEFAULT_COMPRESSION_THRESHOLD_TOKENS;
    this.recentTurnsToKeep = options.recentTurnsToKeep ?? 3;
  }

  async maybeCompress(history: Message[], baseMessageCount: number): Promise<CompressionResult> {
    return compressConversation(history, {
      baseMessageCount,
      thresholdTokens: this.thresholdTokens,
      recentTurnsToKeep: this.recentTurnsToKeep,
      summarize: async (messages) => this.summarize(messages)
    });
  }

  private async summarize(messages: Message[]): Promise<string> {
    const summary = await this.options.llm.completeText(
      [
        {
          role: "system",
          content:
            "You summarize old coding-agent conversation history. Return a concise structured Chinese summary."
        },
        {
          role: "user",
          content: `请总结以下早期对话，必须包含四部分：\n1. 用户目标\n2. 已完成操作\n3. 当前文件状态\n4. 未解决问题\n\n对话 JSON：\n${JSON.stringify(messages)}`
        }
      ],
      {
        model: "deepseek-v4-flash",
        maxTokens: 2048
      }
    );

    return summary.trim();
  }
}

export async function compressConversation(
  history: Message[],
  options: {
    baseMessageCount: number;
    thresholdTokens: number;
    recentTurnsToKeep: number;
    summarize: (messages: Message[]) => Promise<string>;
  }
): Promise<CompressionResult> {
  const beforeTokens = estimateHistoryTokens(history);
  if (beforeTokens <= options.thresholdTokens) {
    return {
      compressed: false,
      beforeTokens,
      afterTokens: beforeTokens,
      history
    };
  }

  const base = history.slice(0, options.baseMessageCount);
  const conversation = history.slice(options.baseMessageCount);
  const preserveFrom = findRecentTurnStart(conversation, options.recentTurnsToKeep);
  const toCompress = conversation.slice(0, preserveFrom);
  const recent = conversation.slice(preserveFrom);

  if (toCompress.length === 0) {
    return {
      compressed: false,
      beforeTokens,
      afterTokens: beforeTokens,
      history
    };
  }

  const summary = await options.summarize(toCompress);
  const nextHistory: Message[] = [
    ...base,
    {
      role: "system",
      content: `${CONVERSATION_SUMMARY_PREFIX}\n${summary}`
    },
    ...recent
  ];
  const afterTokens = estimateHistoryTokens(nextHistory);

  return {
    compressed: true,
    beforeTokens,
    afterTokens,
    history: nextHistory
  };
}

function findRecentTurnStart(messages: Message[], turnsToKeep: number): number {
  let turnsSeen = 0;

  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") {
      turnsSeen++;
      if (turnsSeen === turnsToKeep) {
        return index;
      }
    }
  }

  return 0;
}
