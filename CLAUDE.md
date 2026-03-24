# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
pnpm dev                          # Vite dev server for web-app
pnpm --filter mind-os dev         # Same, explicit

# Building
pnpm build                        # Build all packages (recursive)
pnpm build:libs                   # Build packages/* only
pnpm --filter @itookit/vfslib build

# Type checking
pnpm typecheck                    # All packages (recursive)
cd packages/<pkg> && npx tsc --noEmit  # Single package

# Testing (vfslib has the only full test suite)
pnpm --filter @itookit/vfslib test --run   # Run once
pnpm --filter @itookit/vfslib test         # Watch mode
cd packages/vfslib && npx vitest run src/__tests__/04-tag-ops.test.ts  # Single file
```

Build tools by package type:
- Logic-only packages (`common`, `vfslib`, `llm-driver`, `llm-kernel`, `llm-engine`, vfsdrivers): **tsup** → CJS+ESM + `.d.ts`
- UI packages (`memory-manager`, `vfs-ui`, `llm-ui`, `mdx`, `app-settings`): **vite build**

## Workspace Structure

pnpm monorepo. All packages under `packages/`, main app under `apps/web-app/` (package name `mind-os`).

| Package | Role |
|---|---|
| `@itookit/common` | Shared interfaces, types, and utilities. Zero runtime deps. Source of truth for all cross-package contracts. |
| `@itookit/vfslib` | VFS engine core — POSIX-style virtual filesystem abstraction,support assetdir/ 模块目录级别隔离 / mount不同driver到/不同目录下 |
| `@itookit/vfsdriver-indexeddb` | IndexedDB storage backend (browser) |
| `@itookit/vfsdriver-fs` | SQLite + local FS backend (Node/Electron) |
| `@itookit/llm-driver` | LLM API communication — OpenAI/Anthropic/Gemini, SSE streaming, MCP protocol |
| `@itookit/llm-kernel` | Execution engine core, no UI deps — Executor and Orchestrator types |
| `@itookit/llm-engine` | UI adapter layer — session management, state, VFS persistence (`.chat` files) |
| `@itookit/mdxeditor` | CodeMirror 6 Markdown editor with frontmatter/GFM/Mermaid |
| `@itookit/llm-ui` | Chat UI components and Agent editor factory |
| `@itookit/vfs-ui` | File-tree UI shell (`VFSUIShell`) backed by `ISessionEngine` |
| `@itookit/memory-manager` | Top-level workspace container — combines VFSUIShell + editor + BackgroundBrain |
| `@itookit/app-settings` | Settings module, sync service skeleton, `SettingsEngine` |
| `mind-os` (`apps/web-app`) | Main browser SPA — product entry point |

## Key Architecture

### VFS System

The VFS is a modular virtual filesystem with a clear layering:

```
IStorageBackend  (IndexedDB / SQLite+FS)
    ↕
VFSEngine  —  PathResolver, AccessController, EventBus, PluginPipeline
    ↕
VFSManager (implements IVFSManager)  —  module lifecycle coordinator
    ↕
ModuleFS (implements IModuleFS)  —  chroot-isolated view per module
    ↕ optional capability sub-interfaces
ITagOperations, IAssetOperations, ISeqFileOperations, IRefOperations, IWatchOperations
```

All interfaces live in `packages/common/src/interfaces/fs/`. **Callers always type their VFS dependency as `IVFSManager` or `IModuleFS`** — never the concrete classes. Concrete wiring (`createVFS()`) happens only in `apps/web-app/src/services/vfs.ts`.

Each **module** is a named namespace. A module's `IModuleFS` maps its `/` root to the system path `/module/<moduleName>/`. Modules correspond 1:1 with workspace tabs — defined in `apps/web-app/src/config/modules.ts` (`WORKSPACES` array) and auto-mounted at startup.

`createVFS({ rootBackend, modules })` → `{ manager: IVFSManager, config: IConfigService }`.

**Backup/restore/export/import** live on `vfs.maintenance.*` (a sub-service), not directly on `vfs`.

### ISessionEngine — the UI/backend contract

`ISessionEngine` (`packages/common/src/interfaces/ISessionEngine.ts`) is the single interface used by all UI packages to talk to any backend. Key methods: `init()`, `loadTree()`, `getChildren()`, `readContent()`, `createFile()`, `createDirectory()`, `rename()`, `move()`, `delete()`, `setTags()`, `on()`.

Two main implementations:
- **`VFSModuleEngine`** (`packages/vfslib/src/adapter-session/`) — adapts `IVFSManager` → `ISessionEngine` for standard file workspaces
- **`LLMSessionEngine`** (`packages/llm-engine/src/persistence/`) — Chat-specific; stores sessions as `.chat` files with a branching message graph in hidden VFS directories

Services needing direct VFS access extend **`BaseModuleService`** (`packages/vfslib/src/adapter-session/`) — provides `readJson`/`writeJson` (upsert semantics), `ensureDirectory`, and `engine: VFSModuleEngine`.

### Workspace Strategy Pattern (web-app)

```ts
interface WorkspaceStrategy {
    getFactory(): EditorFactory;
    getEngine(moduleName: string): ISessionEngine;
}
```

Four strategies: `StandardWorkspaceStrategy` (MDxEditor + `VFSModuleEngine`), `ChatWorkspaceStrategy` (`LLMSessionEngine`), `AgentWorkspaceStrategy`, `SettingsWorkspaceStrategy`. Adding a workspace = adding an entry to `WORKSPACES` in `apps/web-app/src/config/modules.ts`.

### LLM Engine Stack

```
llm-driver  →  LLMConnection / streaming / MCP / multi-provider
llm-kernel  →  Executor (Agent/HTTP/Tool/Script) + Orchestrator (Serial/Parallel/Router/Loop/DAG)
llm-engine  →  SessionManager, LLMSessionEngine (→ vfslib), VFSAgentService (→ vfslib)
llm-ui      →  UI components for Chat and Agent editing
```

`initializeLLMEngine(options)` in `packages/llm-engine/src/index.ts` wires the kernel, `VFSAgentService`, `LLMSessionEngine`, `PromptHistoryService`, and returns a `SessionManager`.

### Chat Persistence Format

Each `.chat` file is a `ChatManifest` JSON with a named-branch message graph: `branches: Record<branchName, headNodeId>`. Individual messages are stored as `/.{sessionId}/.{nodeId}.json` (hidden dirs inside the chat module).

### FSNode Types

Discriminated union: `FSNode = FSFileNode | FSDirectoryNode | FSSeqFileNode | FSDeviceNode | FSSymlinkNode` — all fields `readonly`. `FSFileNode` carries `size` and `assetDirId`; others do not. Type-narrow before accessing type-specific fields.

### Event System

`IModuleFS` extends `FSEventEmitter` — `on(eventType, callback): () => void` returns an unsubscriber. `IVFSManager` has typed `on<E extends VFSManagerEventType>(...)` for `node:created`, `node:updated`, `node:deleted`, `module:mounted`, `module:unmounted`. Note: `node:deleted` payload has `nodeIds[]` + `moduleId` but **no `path`** field.

## Conventions

- **`vfs.write(moduleName, path, content)`** has upsert semantics — creates file and intermediate directories automatically. Prefer over check-then-create.
- **Avoid `exists` + `read` patterns** (TOCTOU) — just read and catch not-found errors.
- **Path formats**: module-relative paths start with `/`. Cross-module system paths: `/module/<name>/path`, `/__config/...`, `/dev/...`. Use `toSystemPath` / `parseSystemPath` from `packages/common/src/utils/fsHelpers.ts`.
- **Asset directories** use `_` prefix (e.g., `_filename.md/` is the asset dir for `filename.md`).
- **`toBuffer(content)`** from `@itookit/vfslib` converts `string | ArrayBuffer | Uint8Array → ArrayBuffer`. Use it instead of manual `TextEncoder`/`.buffer.slice()` patterns.
- **`__config` module** is auto-mounted at VFS init; settings are stored there.
- **DB name** is `'MindOS-v2'` (IndexedDB). The old `'MindOS'` schema (v7) is incompatible with the current vfslib schema (v1).
- **Sync plugin** (`SyncService`) is a stub — `ISyncPlugin` is a local interface in app-settings; real sync is not yet implemented.
