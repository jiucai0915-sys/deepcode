# DeepCode 操作手册

> 当前版本：本地 CLI Coding Agent 原型  
> 技术栈：TypeScript + Node.js + pnpm + DeepSeek API  
> 工作目录：`E:\deepcode`

## 1. 当前状态

DeepCode 现在已经不是单纯 demo，而是一个可日常试用的 DeepSeek 原生 CLI coding agent。

已经具备：

- DeepSeek 流式对话
- Tool Calling
- 文件读取、写入、单点编辑、批量编辑
- 命令执行
- 目录树读取
- 内容搜索和文件名搜索
- Git 状态、diff、log、commit
- 四级权限系统
- Token 成本统计
- 上下文压缩
- Session 持久化
- `/undo`
- `.deepcodeignore`
- 项目上下文快照
- Git 仓库初始化和初始提交

当前 Git 提交：

```text
05d5550 feat: add project ignore and context snapshot
17f850b chore: initial deepcode prototype
```

## 2. 启动方式

进入项目目录：

```powershell
cd E:\deepcode
```

安装依赖：

```powershell
corepack pnpm install
```

构建：

```powershell
corepack pnpm build
```

启动 CLI：

```powershell
corepack pnpm start
```

首次启动如果没有全局配置，会提示输入 DeepSeek API Key：

```text
DeepSeek API Key:
```

输入后会保存到：

```text
~\.deepcode\config.json
```

之后不需要每次设置环境变量。

## 3. 常用 CLI 命令

| 命令 | 作用 |
|---|---|
| `/help` | 查看帮助 |
| `/model flash` | 切换到 `deepseek-v4-flash` |
| `/model pro` | 切换到 `deepseek-v4-pro` |
| `/model <name>` | 切换到指定模型 |
| `/think on` | 开启 thinking |
| `/think off` | 关闭 thinking |
| `/history` | 查看最近 10 个 session |
| `/resume` | 恢复上一段 session |
| `/undo` | 撤销 DeepCode 最近一次文件写入或编辑 |
| `/cost` | 查看当前 CLI 会话累计 token 成本 |
| `/config` | 查看当前有效配置，API Key 会打码 |
| `/tools` | 查看当前所有工具 |
| `/context` | 查看注入给模型的项目上下文 |
| `/init` | 生成 `DEEPCODE.md` 项目说明模板 |
| `/clear` | 清空当前对话历史 |
| `/exit` | 退出 |

## 4. 当前工具清单

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
| `edit_file` | Level 2 | 单点精确替换 |
| `multi_edit` | Level 2 | 多个精确替换，先校验再写入 |
| `run_command` 白名单命令 | Level 1 | 自动执行 |
| `run_command` 非白名单命令 | Level 3 | 每次确认 |
| `write_file` 覆写 | Level 3 | 每次确认 |
| `git_commit` | Level 3 | 每次确认 |
| 危险命令或系统路径 | Level 4 | 永远拒绝 |

## 5. 权限系统

DeepCode 使用四级权限模型：

| 等级 | 行为 | 示例 |
|---|---|---|
| Level 1 | 自动执行 | 读文件、搜索、Git 只读、白名单命令 |
| Level 2 | 首次确认后同类自动 | 新建文件、编辑文件、批量编辑 |
| Level 3 | 每次确认 | 非白名单命令、覆写文件、Git commit |
| Level 4 | 永远拒绝 | `rm -rf`、`format`、`del /s`、系统目录操作 |

默认命令白名单可在全局配置或 `DEEPCODE.md` front matter 中配置。

## 6. 配置系统

配置优先级从高到低：

1. CLI 参数
2. 项目级 `DEEPCODE.md` YAML front matter
3. 全局 `~\.deepcode\config.json`
4. 内置默认值

CLI 示例：

```powershell
corepack pnpm start -- --model pro --think
```

全局配置示例：

```json
{
  "apiKey": "sk-...",
  "baseURL": "https://api.deepseek.com",
  "model": "deepseek-v4-flash",
  "thinking": false,
  "maxToolRounds": 8,
  "compressionThresholdTokens": 80000,
  "commandWhitelist": ["node", "pnpm", "git status", "git diff"]
}
```

项目级 `DEEPCODE.md` 示例：

```markdown
---
model: pro
thinking: true
maxToolRounds: 12
commandWhitelist:
  - node
  - pnpm
  - git status
  - git diff
---

# Project Notes

这里写当前项目的技术栈、约束、测试命令和注意事项。
```

## 7. 项目上下文

DeepCode 启动时会注入两类项目上下文：

- `DEEPCODE.md` 内容，自动去掉 YAML front matter
- 当前项目树快照

项目树快照遵守 `.deepcodeignore`，避免把 `node_modules`、`dist`、`.git`、session、demo 文件塞进上下文。

查看当前上下文：

```text
/context
```

生成项目说明模板：

```powershell
corepack pnpm start -- --init
```

如果已在 DeepCode CLI 内，也可以使用：

```text
/init
```

如果 `DEEPCODE.md` 已存在，CLI 内的 `/init` 会询问是否覆盖；命令行模式可使用：

```powershell
corepack pnpm start -- --init --force
```

## 8. `.deepcodeignore`

当前 `.deepcodeignore`：

```text
node_modules
dist
.git
.deepcode
.deepcode-demo
.next
coverage
.turbo
ignored-by-deepcodeignore
```

受影响功能：

- `list_directory`
- `search_files`
- `search_filenames`
- 项目树快照

## 9. Session

DeepCode 会自动保存对话历史到：

```text
.deepcode\sessions\
```

查看最近 session：

```text
/history
```

恢复上一段 session：

```text
/resume
```

`.deepcode` 已加入 `.gitignore`，不会进入仓库。

## 10. Token 成本统计

DeepCode 会在 DeepSeek API 返回 usage 时输出：

```text
[usage] cache hit ... / miss ... / output ... tokens | cost ¥... | total ¥...
```

价格当前按 V4 Flash 估算：

- 缓存命中输入：`$0.0028 / 1M tokens`
- 缓存未命中输入：`$0.14 / 1M tokens`
- 输出：`$0.28 / 1M tokens`

人民币汇率默认：

```text
DEEPCODE_USD_TO_CNY=7.25
```

可通过环境变量覆盖。

## 11. 上下文压缩

当历史估算 tokens 超过 `80000` 时自动触发压缩：

1. 保留 system prompt 和项目上下文
2. 保留最近 3 轮完整用户对话
3. 将更早历史发给 V4 Flash 总结
4. 用结构化摘要替换早期历史

摘要包含：

- 用户目标
- 已完成操作
- 当前文件状态
- 未解决问题

## 12. 标准验证命令

每次改完项目后运行：

```powershell
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:unit
corepack pnpm test:integration
corepack pnpm smoke
```

全部通过后再提交。

说明：

- `test:unit` 验证纯逻辑模块，如权限、配置、成本、压缩、session、`DEEPCODE.md` 初始化。
- `test:integration` 验证文件系统、工具链、Git 临时仓库和命令执行。
- `smoke` 会依次运行 unit 和 integration，适合提交前最终检查。

## 13. 端到端能力验证 Prompt

在 DeepCode CLI 中粘贴：

```text
请对当前 DeepCode 项目做一次端到端能力验证：先用 list_directory 查看项目结构，再读取 package.json、README.md 和 src/agent/loop.ts；用 search_filenames 找出所有和 git、session、permission、multi-edit 相关的源码文件；用 search_files 搜索 PermissionManager、SessionStore、ConversationCompressor、multi_edit、git_commit 的实现位置；然后在 .deepcode-demo/ability-check.ts 创建一个 TypeScript 文件，实现 add、multiply、safeDivide 三个函数，并在 .deepcode-demo/ability-check.test.mjs 创建 Node assert 测试文件；写完后不要停下来问我要不要验证，主动运行合适的 node 命令执行测试；如果测试失败，读取相关文件并修复直到通过；测试通过后使用 git_status、git_diff、git_log 查看当前仓库状态、未提交修改和最近提交；最后总结：你调用了哪些工具、创建或修改了哪些文件、运行了什么命令、测试结果如何、是否看到 token 成本统计。不要执行 git_commit。
```

## 14. Git 工作流

查看状态：

```powershell
git status --short --branch
```

提交前验证：

```powershell
corepack pnpm typecheck
corepack pnpm build
corepack pnpm smoke
```

提交：

```powershell
git add .
git commit -m "feat: describe change"
```

当前仓库已经有初始提交和项目感知提交。

## 15. 常见问题

### Git 工具提示不是 Git 仓库

说明当前目录没有 `.git`。解决：

```powershell
cd E:\deepcode
git init
git add .
git commit -m "chore: initial commit"
```

当前项目已经初始化过，一般不会再遇到。

### 没有 token 成本输出

只有真实调用 DeepSeek API 且 API 返回 usage 时才会输出。纯本地工具操作不会产生 usage。

### PowerShell 不能运行 `pnpm`

优先使用：

```powershell
corepack pnpm <command>
```

### 中文显示乱码

在 PowerShell 中执行：

```powershell
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:LANG = "zh_CN.UTF-8"
```

## 16. 下一阶段路线

优先级建议：

1. 完善测试体系，把 smoke 拆成单元测试和集成测试
2. 增加更稳定的 token 计算器
3. 做 npm 发布准备
4. 增加 README 中英文版
5. 增加 GitHub Actions
6. 再考虑 Ink UI、Web Search、子 Agent、MCP 和插件系统
