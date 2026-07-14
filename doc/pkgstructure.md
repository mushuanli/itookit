
## Workspace Structure

pnpm monorepo. All packages under `packages/`, main app under `apps/web-app/` (package name `mind-os`).

| Package | Role |
|---|---|
| `@itookit/common` | Shared interfaces, types, and utilities. Zero runtime deps. Source of truth for all cross-package contracts. |
| `@itookit/vfslib` | VFS engine core — POSIX-style virtual filesystem abstraction, assetdir/ 模块目录级别隔离，mount 不同 driver 到不同目录 |
| `@itookit/vfsdriver-indexeddb` | IndexedDB storage backend (browser) |
| `@itookit/vfsdriver-localfs` | SQLite + local FS backend (Node/Electron) |
| `@itookit/device-llm` | LLM API communication — OpenAI/Anthropic/Gemini, SSE streaming, MCP protocol, Skill/Connection VFS storage |
| `@itookit/device-tty` | TTY device driver — Node.js child_process interactive shell sessions |
| `@itookit/tools` | Built-in tool implementations (`buildTool()` factory) — FileRead/Write/Edit, Glob, Grep, Bash, Skill, Agent, Task, PlanMode, AskUserQuestion, WebFetch; adapter `ToolDeviceDriver` |
| `@itookit/llm-harness` | Multi-turn agent loop — `AgentLoopExecutor`, harness-specific tools (load_skill, delegate_task), context compression, HITL queue, SubAgentRouter |
| `@itookit/llm-engine` | Session management + VFS persistence (`.chat` files) + Mission orchestration + Session dependency graph + Goal control loop (reconcile) + ILoop executors + ILog (ChatEngineLog) + ISession + ICommandBus |
| `@itookit/mdxeditor` | CodeMirror 6 Markdown editor with frontmatter/GFM/Mermaid |
| `@itookit/llm-ui` | Chat UI components and Agent editor factory |
| `@itookit/vfs-ui` | File-tree UI shell (`VFSUIShell`) backed by `ISessionEngine` |
| `@itookit/memory-manager` | Top-level workspace container — combines VFSUIShell + editor + BackgroundBrain |
| `@itookit/app-settings` | Settings module, `SettingsEngine`, `SkillsEngine` |
| `@itookit/app-shell` | Bootstrap glue — `initApp()`, workspace strategy wiring, routing, harness/VFS/LLM assembly |
| `mind-os` (`apps/web-app`) | Main browser SPA — `IndexedDBBackend`, workspace config, entry point |
| `apps/sync-server` | Hono HTTP server — diff-based file sync (SQLite blob store + Bearer auth) |
