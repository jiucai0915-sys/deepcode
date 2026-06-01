import OpenAI from "openai";
import type { LLMConfig, Message, StreamEvent, TokenUsage, ToolDefinition } from "./types.js";

type PendingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export class LLMClient {
  private client: OpenAI;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = { ...config };
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL
    });
  }

  async *chat(messages: Message[], tools?: ToolDefinition[]): AsyncGenerator<StreamEvent> {
    try {
      const requestBody: Record<string, unknown> = {
        model: this.config.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: this.config.maxTokens
      };

      if (tools?.length) {
        requestBody.tools = tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }
        }));
      }

      if (this.config.thinking) {
        requestBody.thinking = { type: "enabled" };
        requestBody.reasoning_effort = this.config.reasoningEffort;
      }

      const stream = (await this.client.chat.completions.create(
        requestBody as never
      )) as unknown as AsyncIterable<any>;
      const pendingToolCalls = new Map<number, PendingToolCall>();

      for await (const chunk of stream) {
        if (chunk.usage) {
          yield { type: "usage", usage: normalizeUsage(chunk.usage) };
        }

        const choice = chunk.choices?.[0];
        const delta = choice?.delta;

        if (delta?.reasoning_content) {
          yield { type: "reasoning", content: delta.reasoning_content };
        }

        if (delta?.content) {
          yield { type: "text", content: delta.content };
        }

        if (delta?.tool_calls) {
          for (const call of delta.tool_calls) {
            const index = call.index ?? 0;
            const pending = pendingToolCalls.get(index) ?? {
              id: "",
              name: "",
              arguments: ""
            };

            if (call.id) pending.id = call.id;
            if (call.function?.name) pending.name = call.function.name;
            if (call.function?.arguments) pending.arguments += call.function.arguments;

            pendingToolCalls.set(index, pending);
          }
        }

        if (choice?.finish_reason) {
          for (const pending of pendingToolCalls.values()) {
            yield {
              type: "tool_call",
              toolCall: {
                id: pending.id,
                type: "function",
                function: {
                  name: pending.name,
                  arguments: pending.arguments
                }
              }
            };
          }

          yield { type: "done", finishReason: choice.finish_reason };
        }
      }
    } catch (error) {
      yield { type: "error", error: error as Error };
    }
  }

  async completeText(
    messages: Message[],
    options?: {
      model?: string;
      maxTokens?: number;
    }
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: options?.model ?? this.config.model,
      messages: messages as never,
      stream: false,
      max_tokens: options?.maxTokens ?? this.config.maxTokens
    } as never);

    const content = (response as any).choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
  }

  setModel(model: string) {
    const aliases: Record<string, string> = {
      flash: "deepseek-v4-flash",
      pro: "deepseek-v4-pro"
    };
    this.config.model = aliases[model] ?? model;
  }

  setThinking(enabled: boolean) {
    this.config.thinking = enabled;
  }

  getConfig(): LLMConfig {
    return { ...this.config };
  }
}

function normalizeUsage(usage: Record<string, unknown>): TokenUsage {
  return {
    promptCacheHitTokens: readUsageNumber(usage, "prompt_cache_hit_tokens"),
    promptCacheMissTokens: readUsageNumber(usage, "prompt_cache_miss_tokens"),
    completionTokens: readUsageNumber(usage, "completion_tokens")
  };
}

function readUsageNumber(usage: Record<string, unknown>, key: string): number {
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
