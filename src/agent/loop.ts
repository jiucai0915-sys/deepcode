import type { LLMClient } from "../llm/client.js";
import type { Message, StreamEvent, TokenUsage, ToolCall } from "../llm/types.js";
import type { PermissionManager } from "../security/permissions.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ChangeTracker } from "./change-tracker.js";
import type { ConversationCompressor } from "./compressor.js";

export interface AgentLoopOptions {
  llm: LLMClient;
  tools: ToolRegistry;
  systemPrompt: string;
  projectContext?: string | null;
  compressor?: ConversationCompressor;
  permissions: PermissionManager;
  changeTracker?: ChangeTracker;
  maxToolRounds: number;
  onText: (text: string) => void;
  onReasoning: (text: string) => void;
  onToolCall: (name: string, args: string) => void;
  onToolResult: (name: string, result: string) => void;
  onUsage: (usage: TokenUsage) => void;
  onCompress?: (beforeTokens: number, afterTokens: number) => void;
  onError: (error: Error) => void;
  onConfirm: (message: string) => Promise<boolean>;
}

export class AgentLoop {
  private history: Message[];
  private readonly baseMessageCount: number;

  constructor(private readonly options: AgentLoopOptions) {
    this.history = this.createInitialHistory();
    this.baseMessageCount = this.history.length;
  }

  async run(userMessage: string): Promise<void> {
    this.history.push({ role: "user", content: userMessage });

    for (let round = 0; round < this.options.maxToolRounds; round++) {
      await this.compressIfNeeded();

      let assistantContent = "";
      let reasoningContent = "";
      const toolCalls: ToolCall[] = [];

      for await (const event of this.options.llm.chat(
        this.history,
        this.options.tools.getDefinitions()
      )) {
        if (this.handleStreamEvent(event, toolCalls, (text) => {
          assistantContent += text;
        }, (text) => {
          reasoningContent += text;
        })) {
          return;
        }
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: assistantContent || null
      };

      if (reasoningContent) {
        assistantMessage.reasoning_content = reasoningContent;
      }

      if (toolCalls.length === 0) {
        this.history.push(assistantMessage);
        return;
      }

      assistantMessage.tool_calls = toolCalls;
      this.history.push(assistantMessage);

      for (const toolCall of toolCalls) {
        const result = await this.options.tools.execute(
          toolCall.function.name,
          toolCall.function.arguments,
          {
            confirm: this.options.onConfirm,
            permissions: this.options.permissions,
            changeTracker: this.options.changeTracker,
            onNote: this.options.onText
          }
        );

        this.options.onToolResult(toolCall.function.name, result);
        this.history.push({
          role: "tool",
          content: result,
          tool_call_id: toolCall.id
        });
      }
    }

    this.options.onError(new Error(`Reached max tool rounds (${this.options.maxToolRounds}).`));
  }

  reset() {
    this.history = this.createInitialHistory();
  }

  getHistory(): Message[] {
    return this.history.map((message) => ({ ...message }));
  }

  setHistory(history: Message[]) {
    this.history = history.map((message) => ({ ...message }));
  }

  private handleStreamEvent(
    event: StreamEvent,
    toolCalls: ToolCall[],
    appendText: (text: string) => void,
    appendReasoning: (text: string) => void
  ): boolean {
    switch (event.type) {
      case "text":
        appendText(event.content);
        this.options.onText(event.content);
        return false;
      case "reasoning":
        appendReasoning(event.content);
        this.options.onReasoning(event.content);
        return false;
      case "tool_call":
        toolCalls.push(event.toolCall);
        this.options.onToolCall(event.toolCall.function.name, event.toolCall.function.arguments);
        return false;
      case "done":
        return false;
      case "usage":
        this.options.onUsage(event.usage);
        return false;
      case "error":
        this.options.onError(event.error);
        return true;
    }
  }

  private createInitialHistory(): Message[] {
    const history: Message[] = [{ role: "system", content: this.options.systemPrompt }];

    if (this.options.projectContext) {
      history.push({ role: "system", content: this.options.projectContext });
    }

    return history;
  }

  private async compressIfNeeded() {
    if (!this.options.compressor) return;

    const result = await this.options.compressor.maybeCompress(this.history, this.baseMessageCount);
    if (!result.compressed) return;

    this.history = result.history;
    this.options.onCompress?.(result.beforeTokens, result.afterTokens);
  }
}
