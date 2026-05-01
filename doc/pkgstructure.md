
## Workspace Structure

pnpm monorepo. All packages under `packages/`, main app under `apps/web-app/` (package name `mind-os`).

| Package | Role |
|---|---|
| `@itookit/common` | Shared interfaces, types, and utilities. Zero runtime deps. Source of truth for all cross-package contracts. |
| `@itookit/vfslib` | VFS engine core — POSIX-style virtual filesystem abstraction, assetdir/ 模块目录级别隔离，mount 不同 driver 到不同目录 |
| `@itookit/vfsdriver-indexeddb` | IndexedDB storage backend (browser) |
| `@itookit/vfsdriver-fs` | SQLite + local FS backend (Node/Electron) |
| `@itookit/device-llm` | LLM API communication — OpenAI/Anthropic/Gemini, SSE streaming, MCP protocol, Skill/Connection VFS storage |
| `@itookit/llm-kernel` | Execution engine core, no UI deps — Executor (Agent/HTTP/Tool/Script) + Orchestrator (Serial/Parallel/Router/Loop/DAG) |
| `@itookit/llm-harness` | Multi-turn agent loop — `AgentLoopExecutor`, built-in tools, context compression, HITL queue, SubAgentRouter |
| `@itookit/llm-engine` | Session management + VFS persistence (`.chat` files) + Mission orchestration + Session dependency graph |
| `@itookit/mdxeditor` | CodeMirror 6 Markdown editor with frontmatter/GFM/Mermaid |
| `@itookit/llm-ui` | Chat UI components and Agent editor factory |
| `@itookit/vfs-ui` | File-tree UI shell (`VFSUIShell`) backed by `ISessionEngine` |
| `@itookit/memory-manager` | Top-level workspace container — combines VFSUIShell + editor + BackgroundBrain |
| `@itookit/app-settings` | Settings module, `SettingsEngine`, `SkillsEngine` |
| `@itookit/app-shell` | Bootstrap glue — `initApp()`, workspace strategy wiring, routing, harness/VFS/LLM assembly |
| `mind-os` (`apps/web-app`) | Main browser SPA — `IndexedDBBackend`, workspace config, entry point |
| `apps/sync-server` | Hono HTTP server — diff-based file sync (SQLite blob store + Bearer auth) |
