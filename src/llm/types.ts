export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface TokenUsage {
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  completionTokens: number;
}

export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; finishReason: string }
  | { type: "error"; error: Error };

export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  thinking: boolean;
  reasoningEffort: "low" | "medium" | "high" | "max";
  maxTokens: number;
}

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  apiKey: "",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  thinking: false,
  reasoningEffort: "high",
  maxTokens: 8192
};
