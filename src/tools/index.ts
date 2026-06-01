import { editFileTool } from "./edit-file.js";
import { gitCommitTool, gitDiffTool, gitLogTool, gitStatusTool } from "./git.js";
import { listDirectoryTool } from "./list-directory.js";
import { multiEditTool } from "./multi-edit.js";
import { readFileTool } from "./read-file.js";
import { runCommandTool } from "./run-command.js";
import { searchFilenamesTool } from "./search-filenames.js";
import { searchFilesTool } from "./search-files.js";
import { ToolRegistry } from "./registry.js";
import { writeFileTool } from "./write-file.js";

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(listDirectoryTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(multiEditTool);
  registry.register(runCommandTool);
  registry.register(searchFilesTool);
  registry.register(searchFilenamesTool);
  registry.register(gitStatusTool);
  registry.register(gitDiffTool);
  registry.register(gitLogTool);
  registry.register(gitCommitTool);
  return registry;
}

export { ToolRegistry };
