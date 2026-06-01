import type { Message } from "../llm/types.js";

export function estimateMessageTokens(message: Message): number {
  const content = [
    message.role,
    message.content ?? "",
    message.reasoning_content ?? "",
    message.tool_call_id ?? "",
    JSON.stringify(message.tool_calls ?? "")
  ].join("\n");

  return Math.ceil(content.length / 4) + 8;
}

export function estimateHistoryTokens(messages: Message[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}
