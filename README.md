# DeepCode

DeepCode 是一个 DeepSeek 原生终端编程 Agent。它可以在本地 CLI 中理解项目、读取文件、编辑代码、运行命令、搜索代码、查看 Git 状态、保存会话、统计 token 成本，并通过权限系统保护危险操作。

DeepCode is a DeepSeek-native coding agent for your terminal. It can understand a local project, read and edit files, run commands, search code, inspect Git state, persist sessions, report token cost, and protect risky operations with a permission system.

当前中文操作手册见：[docs/OPERATION_MANUAL.md](docs/OPERATION_MANUAL.md)。

## 中文

### 安装

DeepCode 需要 Node.js 20+，在 Windows、macOS、Linux 上都可以运行。

克隆并构建：

```bash
git clone https://github.com/jiucai0915-sys/deepcode.git
cd deepcode
npm install
npm run build
npm start
```

> 也可以用 pnpm：`pnpm install && pnpm build && pnpm start`。
>
> Windows PowerShell 用法相同，只是进入目录的命令是 `cd path\to\deepcode`。

如果你要在新项目中初始化 DeepCode 项目说明：

```bash
npm start -- --init
```

### 首次配置

DeepCode 使用 DeepSeek API。你可以在 [platform.deepseek.com](https://platform.deepseek.com) 注册账号并创建 API Key。新用户通常会有平台赠送的体验额度，具体额度、有效期和计费规则以 DeepSeek 控制台显示为准。

DeepCode 支持三种配置方式。

方式一：首次启动时交互式输入

```bash
npm start
```

如果本机还没有全局配置，DeepCode 会提示：

```text
DeepSeek API Key:
```

输入后会保存到全局配置文件：

```text
macOS / Linux:  ~/.deepcode/config.json
Windows:        %USERPROFILE%\.deepcode\config.json
```

方式二：手动设置环境变量

macOS / Linux：

```bash
export DEEPSEEK_API_KEY="sk-your-api-key"
npm start
```

Windows PowerShell：

```powershell
$env:DEEPSEEK_API_KEY = "sk-your-api-key"
npm start
```

也可以把 `DEEPSEEK_API_KEY` 写入系统环境变量。如果还没有全局配置，DeepCode 会在首次启动时把这个环境变量导入并保存到全局配置文件；如果全局配置已经存在，则优先使用全局配置。

方式三：直接编辑全局配置

文件位置：

```text
macOS / Linux:  ~/.deepcode/config.json
Windows:        %USERPROFILE%\.deepcode\config.json
```

完整示例：

```json
{
  "apiKey": "sk-your-api-key",
  "baseURL": "https://api.deepseek.com",
  "model": "deepseek-v4-flash",
  "thinking": false,
  "maxTokens": 8192,
  "maxToolRounds": 8,
  "compressionThresholdTokens": 80000,
  "commandWhitelist": [
    "node",
    "npm",
    "pnpm",
    "npx",
    "tsc",
    "git status",
    "git diff",
    "git log",
    "git branch",
    "dir",
    "ls",
    "cat",
    "type"
  ]
}
```

配置优先级从高到低：

1. CLI 参数，例如 `--model pro --think`
2. 项目级 `DEEPCODE.md` YAML front matter
3. 全局配置 `~/.deepcode/config.json`（Windows 为 `%USERPROFILE%\.deepcode\config.json`）
4. 内置默认值

### 使用教程

下面是 5 个从简单到复杂的真实使用场景。

#### 1. 了解项目结构

用户输入：

```text
请查看当前项目结构，读取 package.json 和 README.md，然后告诉我这个项目是做什么的、有哪些核心模块。
```

Agent 会自动执行：

- `list_directory` 查看目录树
- `read_file` 读取 `package.json`
- `read_file` 读取 `README.md`
- 结合项目树快照进行分析

最终输出：

- 项目用途
- 技术栈
- CLI 入口
- 核心模块，如 agent、tools、config、security、project、llm
- 下一步建议

#### 2. 写一个新功能并验证

用户输入：

```text
在 src/utils/math.ts 里创建 add、multiply、safeDivide 三个函数，然后创建一个 Node assert 测试文件并主动运行测试，直到通过。
```

Agent 会自动执行：

- `list_directory` 判断目录是否存在
- `write_file` 创建源码文件，写入前创建 Git 还原点并请求确认
- `write_file` 创建测试文件
- `run_command` 主动运行测试命令
- 如果失败，继续 `read_file`、`edit_file` 或 `multi_edit` 修复

最终输出：

- 创建了哪些文件
- 运行了什么命令
- 测试是否通过
- 如果有 token usage，会显示本次和累计费用

#### 3. 调试报错

用户输入：

```text
运行当前测试，如果失败，请定位报错原因并自动修复，直到测试通过。
```

Agent 会自动执行：

- `run_command` 运行测试
- 读取 stderr/stdout
- `read_file` 读取相关源码或测试
- `edit_file` 或 `multi_edit` 修复
- 再次 `run_command` 验证

最终输出：

- 原始报错摘要
- 根因分析
- 修改了哪些代码
- 最终测试结果

#### 4. 搜索并重构代码

用户输入：

```text
搜索所有使用 ChangeTracker 的地方，把相关命名和注释整理得更清晰。如果需要改多个位置，使用批量编辑并保持测试通过。
```

Agent 会自动执行：

- `search_files` 搜索 `ChangeTracker`
- `search_filenames` 定位相关文件
- `read_file` 查看上下文
- `multi_edit` 对单文件多个位置做原子替换
- 如果涉及多个文件，则逐个校验后修改
- `run_command` 运行验证

最终输出：

- 命中的文件和行号
- 重构思路
- 修改清单
- 验证命令和结果

#### 5. Git 工作流

用户输入：

```text
查看当前 Git 状态和 diff，总结改动。如果没有问题，请用 conventional commit 格式提交。
```

Agent 会自动执行：

- `git_status` 查看工作区状态
- `git_diff` 查看未提交修改
- `git_log` 了解最近提交风格
- 总结改动
- `git_commit` 提交，提交前会请求 Level 3 确认

最终输出：

- 当前分支和工作区状态
- diff 摘要
- 提交信息
- commit hash

### CLI 命令

| 命令 | 作用 |
|---|---|
| `/help` | 查看帮助 |
| `/model flash` | 切换到 `deepseek-v4-flash` |
| `/model pro` | 切换到 `deepseek-v4-pro` |
| `/think on` / `/think off` | 开关 thinking |
| `/history` | 查看最近 10 个 session |
| `/resume` | 恢复上一段 session |
| `/undo` | 基于 Git 还原点撤销上一次 DeepCode 文件改动 |
| `/cost` | 查看当前 CLI 会话累计 token 成本 |
| `/config` | 查看当前有效配置，API Key 会打码 |
| `/tools` | 查看当前所有工具 |
| `/context` | 查看注入给模型的项目上下文 |
| `/init` | 生成 `DEEPCODE.md` 项目说明模板 |
| `/clear` | 清空当前对话历史 |
| `/exit` | 退出 |

### 工具清单

| 工具 | 权限等级 | 说明 |
|---|---:|---|
| `read_file` | Level 1 | 读取工作区内文件 |
| `list_directory` | Level 1 | 列目录树，遵守 `.deepcodeignore` |
| `search_files` | Level 1 | 正则搜索文件内容 |
| `search_filenames` | Level 1 | 正则搜索文件名或相对路径 |
| `git_status` | Level 1 | 查看 Git 状态 |
| `git_diff` | Level 1 | 查看未提交 diff |
| `git_log` | Level 1 | 查看最近提交 |
| `write_file` 新建 | Level 2 | 首次确认后同类自动 |
| `edit_file` | Level 2 | 精确替换 |
| `multi_edit` | Level 2 | 批量精确替换 |
| `run_command` 白名单命令 | Level 1 | 自动执行 |
| `run_command` 非白名单命令 | Level 3 | 每次确认 |
| `write_file` 覆写 | Level 3 | 每次确认 |
| `git_commit` | Level 3 | 每次确认 |
| 危险命令或系统路径 | Level 4 | 永远拒绝 |

### DEEPCODE.md 配置详解

`DEEPCODE.md` 是项目级说明文件，放在项目根目录。DeepCode 启动时会读取它，并把内容注入模型上下文。它适合写：

- 项目技术栈
- 常用命令
- 编码规范
- 不要触碰的文件
- 测试约定
- 项目级模型配置
- 命令白名单

完整格式：

```markdown
---
model: flash
thinking: false
maxToolRounds: 8
compressionThresholdTokens: 80000
commandWhitelist:
  - node
  - pnpm
  - git status
  - git diff
---

# Project Notes

## Project

- Name: your-project
- Purpose: Describe the project.

## Tech Stack

- Add frameworks, languages, database, services.

## Common Commands

- `pnpm build`
- `pnpm test`

## Coding Rules

- Follow existing style.
- Read files before editing.

## Safety Notes

- Do not edit generated files.
- Do not run destructive commands.
```

生成模板：

```bash
npm start -- --init
```

或在 CLI 中：

```text
/init
```

#### 示例：电商网站项目

```markdown
---
model: pro
thinking: true
maxToolRounds: 12
commandWhitelist:
  - node
  - pnpm
  - pnpm build
  - pnpm test
  - git status
  - git diff
  - git log
---

# Project Notes

## Project

- Name: storefront
- Purpose: B2C 电商网站，包含商品列表、购物车、订单和支付流程。

## Tech Stack

- Next.js 14
- TypeScript
- Tailwind CSS
- Prisma
- PostgreSQL
- Stripe

## Common Commands

- `pnpm dev`
- `pnpm build`
- `pnpm test`
- `pnpm lint`

## Coding Rules

- React 组件使用函数组件和 Hooks。
- 文件命名使用 kebab-case。
- API route 必须校验输入。
- 修改 checkout、payment、order 相关代码前先读取现有测试。

## Safety Notes

- 不要修改生产支付密钥。
- 不要删除 migration。
- 不要跳过订单金额校验。

## Testing Notes

- UI 改动运行 `pnpm test`。
- 支付流程改动至少运行 checkout 相关测试。
```

#### 示例：Python 后端项目

```markdown
---
model: pro
thinking: true
maxToolRounds: 10
commandWhitelist:
  - python
  - pytest
  - pip
  - git status
  - git diff
  - git log
---

# Project Notes

## Project

- Name: inventory-api
- Purpose: 库存管理后端，提供商品、仓库、库存同步 API。

## Tech Stack

- Python 3.12
- FastAPI
- SQLAlchemy
- PostgreSQL
- pytest

## Common Commands

- `pytest`
- `pytest tests/test_inventory.py`
- `python -m app.main`

## Coding Rules

- API 层只处理请求和响应，不写业务逻辑。
- 业务逻辑放在 service 层。
- 数据访问放在 repository 层。
- 每个 bug fix 至少补一个 pytest 用例。

## Safety Notes

- 不要修改线上数据库连接字符串。
- 不要执行删除数据库或清空表的命令。
- migration 需要用户明确要求才可修改。

## Testing Notes

- 默认运行 `pytest`。
- 如果只改库存逻辑，优先运行 `pytest tests/test_inventory.py`。
```

### 项目感知与忽略规则

`.deepcodeignore` 控制 DeepCode 忽略哪些文件和目录。它会影响：

- `list_directory`
- `search_files`
- `search_filenames`
- 项目树上下文快照

示例：

```text
node_modules
dist
.git
.deepcode
.deepcode-demo
.next
coverage
.turbo
```

### 权限与安全

DeepCode 使用四级权限：

- Level 1：自动执行，只读工具和白名单命令。
- Level 2：首次确认后同类自动，例如新建文件、编辑文件、批量编辑。
- Level 3：每次确认，例如非白名单命令、覆写文件、`git_commit`。
- Level 4：永远拒绝，例如 `rm -rf`、`format`、`del /s`、系统目录操作。

### 验证

```bash
npm run typecheck
npm run build
npm run test:unit
npm run test:integration
npm run smoke
```

### FAQ

#### API Key 怎么申请？新用户有多少免费额度？

去 [platform.deepseek.com](https://platform.deepseek.com) 注册并创建 API Key。新用户通常会有平台赠送的体验额度，但具体额度、有效期和计费规则可能变化，请以 DeepSeek 控制台为准。

#### 支持哪些操作系统？

已在 **Windows 11 + PowerShell** 和 **macOS** 上验证（构建、测试、CLI 启动均通过）。只要有 Node.js 20+，Linux 同样可用。路径、全局配置目录和危险路径防护都做了跨平台处理。

#### 如何升级到最新版本？

如果是本地源码：

```bash
git pull
npm install
npm run build
```

如果未来从 npm 安装：

```powershell
npm install -g @bakblake/deepcode@latest
```

#### 遇到网络错误怎么办？

检查：

- DeepSeek API Key 是否正确
- 网络是否能访问 `https://api.deepseek.com`
- 账户余额或赠送额度是否可用
- 是否存在代理、防火墙或公司网络限制

#### 如何查看 token 消耗和费用？

每次 DeepSeek API 返回 usage 时，终端会显示：

```text
[usage] cache hit ... / miss ... / output ... tokens | cost ¥... | total ¥...
```

也可以输入：

```text
/cost
```

#### Windows 中文乱码怎么解决？

在 PowerShell 中执行：

```powershell
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:LANG = "zh_CN.UTF-8"
```

建议使用 Windows Terminal。

#### 和 Claude Code / Aider 的区别是什么？

DeepCode 的目标是成为 DeepSeek 原生的终端 coding agent：

- 更贴近 DeepSeek API、成本和模型特性。
- 内置人民币成本统计。
- 支持项目级 `DEEPCODE.md` 和 `.deepcodeignore`。
- 权限系统和 session 持久化从一开始就作为核心能力。
- 当前仍是原型，UI、生态、稳定性和成熟度还不如 Claude Code / Aider。

## English

### Installation

DeepCode needs Node.js 20+ and runs on Windows, macOS, and Linux.

```bash
git clone https://github.com/jiucai0915-sys/deepcode.git
cd deepcode
npm install
npm run build
npm start
```

> pnpm also works: `pnpm install && pnpm build && pnpm start`.
>
> On Windows PowerShell the commands are the same; only the directory path differs (`cd path\to\deepcode`).

To initialize project notes in a new project:

```bash
npm start -- --init
```

### First-Time Configuration

DeepCode uses the DeepSeek API. Create an API key at [platform.deepseek.com](https://platform.deepseek.com). New users usually receive trial credits, but the exact amount, expiration, and billing rules may change. Always check the DeepSeek console for the current quota.

DeepCode supports three configuration methods.

Method 1: interactive setup on first launch.

```bash
npm start
```

If no global config exists, DeepCode prompts:

```text
DeepSeek API Key:
```

After you enter the key, DeepCode saves it to the global config file:

```text
macOS / Linux:  ~/.deepcode/config.json
Windows:        %USERPROFILE%\.deepcode\config.json
```

Method 2: set `DEEPSEEK_API_KEY`.

macOS / Linux:

```bash
export DEEPSEEK_API_KEY="sk-your-api-key"
npm start
```

Windows PowerShell:

```powershell
$env:DEEPSEEK_API_KEY = "sk-your-api-key"
npm start
```

If the global config file does not exist yet, DeepCode imports this environment variable into the global config during first launch. Existing global config still has priority.

Method 3: edit the global config file directly.

File path:

```text
macOS / Linux:  ~/.deepcode/config.json
Windows:        %USERPROFILE%\.deepcode\config.json
```

Example global config:

```json
{
  "apiKey": "sk-your-api-key",
  "baseURL": "https://api.deepseek.com",
  "model": "deepseek-v4-flash",
  "thinking": false,
  "maxTokens": 8192,
  "maxToolRounds": 8,
  "compressionThresholdTokens": 80000,
  "commandWhitelist": [
    "node",
    "npm",
    "pnpm",
    "npx",
    "tsc",
    "git status",
    "git diff",
    "git log",
    "git branch",
    "dir",
    "ls",
    "cat",
    "type"
  ]
}
```

Configuration priority:

1. CLI flags
2. YAML front matter in `DEEPCODE.md`
3. `~/.deepcode/config.json`
4. Built-in defaults

### Tutorial

#### 1. Understand a Project

User prompt:

```text
Inspect this project structure, read package.json and README.md, then explain what this project does and what the core modules are.
```

The agent will automatically run:

- `list_directory` to inspect the project tree
- `read_file` for `package.json`
- `read_file` for `README.md`
- Project-context analysis

Final output:

- Project purpose
- Tech stack
- CLI entry point
- Core modules such as agent, tools, config, security, project, and llm
- Suggested next steps

#### 2. Build and Validate a Feature

User prompt:

```text
Create add, multiply, and safeDivide in src/utils/math.ts, add a Node assert test, and run the test until it passes.
```

The agent will automatically run:

- `list_directory` to check whether target directories exist
- `write_file` to create the source file, with a Git restore point before modification
- `write_file` to create the test file
- `run_command` to run the test
- If the test fails, `read_file`, `edit_file`, or `multi_edit` to repair it

Final output:

- Files created
- Commands executed
- Whether validation passed
- Token usage and cost when the DeepSeek API returns usage data

#### 3. Debug an Error

User prompt:

```text
Run the current tests. If they fail, find the cause and fix it until the tests pass.
```

The agent will automatically run:

- `run_command` to execute the test command
- stdout/stderr analysis
- `read_file` for relevant source or test files
- `edit_file` or `multi_edit` to fix the issue
- `run_command` again to verify

Final output:

- Original error summary
- Root-cause analysis
- Files changed
- Final test result

#### 4. Search and Refactor Code

User prompt:

```text
Search for every ChangeTracker usage and clean up related naming and comments. Use batch edits where appropriate and keep tests passing.
```

The agent will automatically run:

- `search_files` for `ChangeTracker`
- `search_filenames` to locate related files
- `read_file` to inspect context
- `multi_edit` for batch replacements
- `run_command` for validation

Final output:

- Matched files and line numbers
- Refactor plan
- Change list
- Validation command and result

#### 5. Git Workflow

User prompt:

```text
Inspect Git status and diff, summarize the changes, and commit them with a conventional commit message if everything looks good.
```

The agent will automatically run:

- `git_status` to inspect the working tree
- `git_diff` to inspect uncommitted changes
- `git_log` to learn recent commit style
- Change summary generation
- `git_commit`, with Level 3 confirmation before committing

Final output:

- Current branch and working-tree status
- Diff summary
- Commit message
- Commit hash

### Commands

- `/help`: show help
- `/model flash|pro|<name>`: switch model
- `/think on|off`: toggle thinking
- `/history`: list recent sessions
- `/resume`: resume the previous session
- `/undo`: undo the last DeepCode file change using a Git restore point
- `/cost`: show cumulative token cost
- `/config`: show effective config with secrets masked
- `/tools`: list available tools
- `/context`: show injected project context
- `/init`: create a `DEEPCODE.md` template
- `/clear`: clear conversation history
- `/exit`: exit

### DEEPCODE.md

`DEEPCODE.md` is a project-level context file located at the project root. It tells DeepCode about the project stack, commands, conventions, safety rules, and model preferences.

It is useful for:

- Project stack and architecture notes
- Common commands
- Coding conventions
- Files the agent should avoid
- Testing expectations
- Project-level model settings
- Command whitelist entries

Complete format:

```markdown
---
model: flash
thinking: false
maxToolRounds: 8
compressionThresholdTokens: 80000
commandWhitelist:
  - node
  - pnpm
  - git status
  - git diff
---

# Project Notes

## Project

- Name: your-project
- Purpose: Describe the project.

## Tech Stack

- Add frameworks, languages, database, services.

## Common Commands

- `pnpm build`
- `pnpm test`

## Coding Rules

- Follow existing style.
- Read files before editing.

## Safety Notes

- Do not edit generated files.
- Do not run destructive commands.
```

Generate one with:

```bash
npm start -- --init
```

Or inside the CLI:

```text
/init
```

#### Example: E-Commerce Website

```markdown
---
model: pro
thinking: true
maxToolRounds: 12
commandWhitelist:
  - node
  - pnpm
  - pnpm build
  - pnpm test
  - git status
  - git diff
  - git log
---

# Project Notes

## Project

- Name: storefront
- Purpose: B2C e-commerce website with product listing, cart, checkout, orders, and payment flow.

## Tech Stack

- Next.js 14
- TypeScript
- Tailwind CSS
- Prisma
- PostgreSQL
- Stripe

## Common Commands

- `pnpm dev`
- `pnpm build`
- `pnpm test`
- `pnpm lint`

## Coding Rules

- Use function components and Hooks for React components.
- Use kebab-case file names.
- Validate input in API routes.
- Read existing tests before changing checkout, payment, or order code.

## Safety Notes

- Do not edit production payment secrets.
- Do not delete migrations.
- Do not bypass order amount validation.

## Testing Notes

- Run `pnpm test` for UI changes.
- For payment-flow changes, run checkout-related tests at minimum.
```

#### Example: Python Backend

```markdown
---
model: pro
thinking: true
maxToolRounds: 10
commandWhitelist:
  - python
  - pytest
  - pip
  - git status
  - git diff
  - git log
---

# Project Notes

## Project

- Name: inventory-api
- Purpose: Inventory-management backend that provides product, warehouse, and stock-sync APIs.

## Tech Stack

- Python 3.12
- FastAPI
- SQLAlchemy
- PostgreSQL
- pytest

## Common Commands

- `pytest`
- `pytest tests/test_inventory.py`
- `python -m app.main`

## Coding Rules

- API layer should only handle request and response logic.
- Business logic belongs in the service layer.
- Data access belongs in the repository layer.
- Every bug fix should add at least one pytest case.

## Safety Notes

- Do not edit production database connection strings.
- Do not run database deletion or table-truncation commands.
- Only edit migrations when the user explicitly asks.

## Testing Notes

- Run `pytest` by default.
- If only inventory logic changed, prefer `pytest tests/test_inventory.py`.
```

### FAQ

#### How do I get an API key? Is there a free quota?

Create an account and API key at [platform.deepseek.com](https://platform.deepseek.com). Trial credits are commonly available for new users, but the exact quota can change. Check the DeepSeek console for the latest amount and billing rules.

#### Which operating systems are supported?

DeepCode is verified on **Windows 11 + PowerShell** and **macOS** (build, tests, and CLI launch all pass). It also runs on Linux with Node.js 20+. Path handling, the global config directory, and dangerous-path protection are all cross-platform.

#### How do I upgrade?

From source:

```bash
git pull
npm install
npm run build
```

From npm once published:

```powershell
npm install -g @bakblake/deepcode@latest
```

#### What if I see network errors?

Check your API key, network access to `https://api.deepseek.com`, account balance/trial credits, and proxy/firewall settings.

#### How do I see token usage and cost?

DeepCode prints usage when the API returns it. You can also run:

```text
/cost
```

#### How do I fix Chinese mojibake on Windows?

Use Windows Terminal and run:

```powershell
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:LANG = "zh_CN.UTF-8"
```

#### How is DeepCode different from Claude Code or Aider?

DeepCode is designed around DeepSeek models and pricing. It emphasizes terminal-native coding, project notes, `.deepcodeignore`, RMB cost reporting, permission levels, Git-aware undo, and session persistence. It is still an early prototype and not yet as mature as Claude Code or Aider.
