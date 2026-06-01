import type { ToolDefinition } from "../llm/types.js";
import type { ChangeTracker } from "../agent/change-tracker.js";
import type { PermissionManager } from "../security/permissions.js";

export interface ToolContext {
  confirm: (message: string) => Promise<boolean>;
  permissions: PermissionManager;
  changeTracker?: ChangeTracker;
  onNote?: (message: string) => void;
}

export interface ToolExecutor {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolExecutor>();

  register(executor: ToolExecutor) {
    this.tools.set(executor.definition.name, executor);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values())
      .map((tool) => tool.definition)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async execute(name: string, argsJson: string, context: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: unknown tool "${name}"`;
    }

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argsJson || "{}");
    } catch (error) {
      return `Error: invalid JSON arguments for ${name}: ${(error as Error).message}`;
    }

    try {
      return await tool.execute(args, context);
    } catch (error) {
      return `Tool ${name} failed: ${(error as Error).message}`;
    }
  }
}
