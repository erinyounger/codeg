# Codeg

[![Release](https://img.shields.io/github/v/release/xintaofei/codeg)](https://github.com/xintaofei/codeg/releases)
[![License](https://img.shields.io/github/license/xintaofei/codeg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB)](https://tauri.app/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)

Codeg（Code Generation）是一个面向多 Agent 的企业级代码生成工作台。
它把不同 AI 编码代理（Claude Code、Codex CLI、OpenCode、Gemini CLI 等）统一到一个桌面应用里，支持会话聚合、并行 worktree 开发、MCP 与 Skills 管理，以及 Git/文件/终端一体化操作。

> 当前版本：`v0.0.x`（快速迭代中，适合早期体验与共建）

## 项目定位

Codeg 的目标不是“又一个聊天窗口”，而是：

- 面向真实研发场景的企业级代码生成工作台
- 统一多代理协作入口
- 支持多分支 / worktree 并发任务开发
- 在单个项目上下文中聚合会话、变更、提交与执行链路
- 逐步演进为稳定高效的 Agent Code Generation Workspace

## 核心亮点

- 多 Agent 统一工作台：同一项目内可同时使用不同代理并行对话
- 本地会话聚合：导入并查看本机历史会话，统一结构化渲染（消息、工具调用、Token、上下文窗口）
- Worktree 并发开发：内置 `git worktree` 流程，支持多窗口并行任务
- MCP 管理中心：扫描本地 MCP，支持官方 Registry 与 Smithery 搜索/安装
- Skills 管理：支持全局 / 项目级 Skills 的查看、编辑、保存与删除
- 工程操作闭环：文件树、Diff、Git 变更、Git Log、提交窗口、内置终端、项目命令

## 能力矩阵

| 模块 | 当前状态 | 说明 |
| --- | --- | --- |
| 本地会话解析与导入 | ✅ | 已支持 Claude Code / Codex / OpenCode / Gemini CLI |
| ACP 实时连接与对话 | ✅ | 已支持 20+ Agent 适配（npx/uvx/二进制） |
| Worktree 并发开发 | ✅ | 分支管理 + `git_worktree_add` + 多文件夹窗口 |
| MCP 管理 | ✅ | 本地扫描 + Marketplace 搜索/安装（Official + Smithery） |
| Skills 管理 | ✅ | 已支持 Claude/Codex/OpenCode/Gemini/OpenClaw |
| 文件工作区 | ✅ | 预览、编辑、Diff、保存、冲突对比 |

## 支持范围

### 1) 会话解析（历史会话聚合）

| Agent | 环境变量优先路径 | macOS / Linux 默认路径 | Windows 默认路径 |
| --- | --- | --- | --- |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects` | `~/.claude/projects` | `%USERPROFILE%\\.claude\\projects` |
| Codex CLI | `$CODEX_HOME/sessions` | `~/.codex/sessions` | `%USERPROFILE%\\.codex\\sessions` |
| OpenCode | `$XDG_DATA_HOME/opencode/opencode.db` | `~/.local/share/opencode/opencode.db` | `%USERPROFILE%\\.local\\share\\opencode\\opencode.db` |
| Gemini CLI | `$GEMINI_CLI_HOME/.gemini` | `~/.gemini` | `%USERPROFILE%\\.gemini` |

> 说明：以上默认路径按当前实现的回退逻辑整理，实际以环境变量为准。

### 2) ACP 连接（实时 Agent 会话）

当前注册表内置：

`Auggie, Autohand, Claude Code, Cline, Codebuddy Code, Codex CLI, Corust Agent, Factory Droid, Gemini CLI, GitHub Copilot, goose, Junie, Kimi CLI, Minion Code, Mistral Vibe, OpenClaw, OpenCode, Qoder CLI, Qwen Code, Stakpak`

### 3) Skills 设置页支持

- 已支持：`Claude Code / Codex / OpenCode / Gemini CLI / OpenClaw`
- 其他代理：后续逐步补齐

### 4) MCP 目标应用

当前可写入配置：

- Claude Code
- Codex
- OpenCode

## 快速开始

### 环境要求

- Node.js `>=22`（推荐）
- pnpm `>=10`
- Rust stable（2021 edition）
- Tauri 2 构建依赖（参考官方文档）

Linux（Debian/Ubuntu）常见依赖示例：

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

### 安装与开发

```bash
pnpm install

# 启动完整桌面应用（Tauri + Next.js）
pnpm tauri dev

# 仅启动前端
pnpm dev

# 前端构建（静态导出到 out/）
pnpm build

# 构建桌面应用
pnpm tauri build

# Lint
pnpm lint .

# Rust 检查（在 src-tauri/ 目录）
cargo check
cargo clippy
cargo build
```

> 当前仓库尚未配置完整自动化测试框架（已有部分 Rust 单元测试）。

## 使用流程（建议）

1. 在欢迎页打开本地目录，或 Clone 仓库。
2. 进入 `Settings > Agents`，执行 Preflight、安装/配置代理。
3. 在分支菜单创建分支或 Worktree，启动并行任务窗口。
4. 新建会话并选择 Agent 开始编码。
5. 在右侧面板查看会话文件改动、Git Changes、Git Log。
6. 使用提交窗口完成选择文件、编辑提交信息与提交。

## 架构概览

```text
Next.js 16 (Static Export) + React 19
        |
        | invoke()
        v
Tauri 2 Commands (Rust)
  |- ACP Manager (agent lifecycle, streaming events, permissions)
  |- Parsers (local session ingestion)
  |- Git / File Tree / Terminal runtime
  |- MCP marketplace + local config writer
  |- SeaORM + SQLite (folders, conversations, settings)
        |
        v
Local Filesystem / Local Agent Data / Git Repos
```

## 目录结构

```text
src/                    # Next.js 前端
  app/                  # 页面与布局（静态导出模式）
  components/           # 业务组件 + UI 组件
  contexts/             # 全局状态（会话、终端、工作区等）
  lib/                  # Tauri 调用封装、类型与工具

src-tauri/src/          # Rust 后端
  acp/                  # Agent Connection Protocol 连接管理
  commands/             # 暴露给前端的 Tauri 命令
  parsers/              # 各代理会话解析器
  db/                   # SQLite/SeaORM 与迁移
  terminal/             # PTY 终端管理
  network/              # 代理等网络设置
```

## 开发约束

- 前端为静态导出模式（`next.config.ts` 中 `output: "export"`）
- 不使用 Next.js 动态路由（`[param]`），统一使用查询参数
- Tauri 命令参数：前端 `camelCase`，Rust 端 `snake_case`
- TypeScript 严格模式（`strict` + noUnused）

## 本地数据存储

- 应用数据库：`appDataDir/codeg.db`（SQLite + WAL）
- 会话原始数据：直接读取各 Agent 本地目录/文件，不做云端中转
- 可导入会话：按“支持范围”中的路径规则扫描并写入本地数据库索引

## 产品路线图

### Near-term

- 会话解析扩展到更多代理格式（统一抽象与插件化注册）
- MCP 安装管理（版本锁定、配置模板、环境校验）
- Skills 模板中心（可复用模板、项目级分发）

### Mid-term

- 多 Agent 协同编排（任务拆分、角色分工、结果合并）
- Worktree 任务面板（任务状态、上下游依赖、可视化流转）
- 团队级配置同步（Agent/MCP/Skills 配置分发）

### Long-term

- 插件化扩展机制（Parser / MCP / Skills 生态）
- 指标看板增强（Token/成本/时延/成功率）
- 组织级知识沉淀：会话资产化、检索、复盘与最佳实践沉淀

## 隐私与安全

- 默认以本地数据为主：会话解析、数据库与项目操作均在本机执行
- 仅在你主动使用时访问网络（如 Agent 安装、MCP 市场搜索、Git 远程操作）
- 支持系统代理配置，便于企业网络环境接入

## 贡献

欢迎通过 Issue / PR 共建，建议优先从以下方向参与：

- 新代理会话解析器
- MCP 兼容层与配置适配
- Worktree 并行开发体验优化
- 会话可视化与指标面板优化

## License

Apache-2.0. See `LICENSE`.
