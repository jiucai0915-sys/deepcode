# DeepCode

DeepCode is a DeepSeek-native terminal coding agent.

Phase 1 goal: chat, read files, write files, edit files, run commands, and repair errors from the terminal.

## Quick Start

```powershell
$env:DEEPSEEK_API_KEY = "sk-..."
pnpm install
pnpm build
pnpm start
```

## Commands

- `/help` shows commands
- `/model flash|pro|<model>` switches model
- `/think on|off` toggles DeepSeek thinking mode
- `/clear` resets conversation history
- `/history` lists recent saved sessions
- `/resume` resumes the previous session
- `/undo` undoes the last DeepCode file write/edit
- `/cost` shows cumulative token cost for the current CLI run
- `/config` prints the effective config with secrets masked
- `/tools` lists available tools
- `/context` shows the project context injected into the model
- `/exit` exits

## Safety

- Read-only tools run automatically.
- File writes, edits, and shell commands ask for confirmation.
- Dangerous commands and paths outside the workspace are blocked.

## Phase 2 Additions

- The agent is instructed to proactively run validation commands after creating code when the user asks for testing or verification.
- Streaming usage is reported after each DeepSeek request: cache hit tokens, cache miss tokens, output tokens, per-request RMB cost, and cumulative RMB cost.
- Tool definitions are emitted in stable sorted order, and `DEEPCODE.md` project context is loaded once at startup for better prompt cache behavior.
- New read-only tools: `search_files`, `git_status`, and `git_diff`.
- New confirmed tool: `git_commit`.

## Phase 3 Additions

- Conversation history is compressed automatically when estimated tokens exceed 80K. DeepCode summarizes older turns with V4 Flash and keeps the latest 3 user turns intact.
- Configuration is loaded from `~/.deepcode/config.json`, YAML front matter in `DEEPCODE.md`, and CLI flags, with CLI flags taking priority.
- First run prompts for a DeepSeek API key and saves it to the global config file.
- Sessions are saved automatically under `.deepcode/sessions/`. Use `/history` to list recent sessions and `/resume` to continue the previous one.
- Permissions now use four levels: automatic read-only tools, first-approval write/edit operations, every-time confirmation for risky operations, and hard rejection for dangerous commands/paths.

## Phase 4 Foundations

- `git_commit` can commit staged changes, or stage all changes first with `all: true`, after Level 3 confirmation.
- `/undo` tracks DeepCode file writes and edits in memory and restores the most recent change on request.
- `/cost` and `/config` expose runtime state without requiring another model request.
- `search_filenames` finds files and directories by name or relative path.
- `multi_edit` applies several exact replacements to one file atomically and participates in `/undo`.
- `git_log` lets the agent inspect recent commit history.

## Project Awareness

- `.deepcodeignore` controls which files and folders DeepCode ignores during directory listing, file-name search, content search, and project tree snapshot generation.
- On startup, DeepCode injects project notes from `DEEPCODE.md` plus a stable project tree snapshot into the model context.
- Use `/context` to inspect the exact project context currently loaded.
