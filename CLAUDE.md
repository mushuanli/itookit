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
- Logic-only packages (`common`, `vfslib`, `device-llm`, `llm-kernel`, `llm-engine`, vfsdrivers): **tsup** → CJS+ESM + `.d.ts`
- UI packages (`memory-manager`, `vfs-ui`, `llm-ui`, `mdx`, `app-settings`): **vite build**

## Workspace Structure

pnpm monorepo. All packages under `packages/`, main app under `apps/web-app/` (package name `mind-os`).

| Package | Role |
|---|---|
| `@itookit/common` | Shared interfaces, types, and utilities. Zero runtime deps. Source of truth for all cross-package contracts. |
| `@itookit/vfslib` | VFS engine core — POSIX-style virtual filesystem abstraction,support assetdir/ 模块目录级别隔离 / mount不同driver到/不同目录下 |
| `@itookit/vfsdriver-indexeddb` | IndexedDB storage backend (browser) |
| `@itookit/vfsdriver-fs` | SQLite + local FS backend (Node/Electron) |
| `@itookit/device-llm` | LLM API communication — OpenAI/Anthropic/Gemini, SSE streaming, MCP protocol |
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
device-llm →  LLMConnection / streaming / MCP / multi-provider
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

## VFS Path Naming Conventions

### Module isolation

Each **module** is a chroot-isolated namespace. A module's `/` maps to `/module/<name>/` in the system tree. Paths passed to `IModuleFS` are always module-relative (start with `/`). Modules never see each other's files directly — cross-module access goes through `IVFSManager`.

### File/directory name prefixes

Four categories, enforced by `validateFilename` + `AccessController`:

| Prefix | Example | Who creates | Default listing | Sync | Notes |
|---|---|---|---|---|---|
| `name` | `notes.md`, `folder/` | user | ✅ visible | ✅ | Normal files |
| `.name` | `.connections/`, `.nodeId.json` | `isSystem` modules only | ❌ hidden | ❌ | Access-controlled by `AccessController`; non-system modules get EACCES |
| `_name/` | `_note.md/` | vfslib (auto) | ❌ hidden | ✅ | **Assetdir** — companion dir for `note.md`; lifecycle coupled to owner (auto-renamed/moved/deleted) |
| `__config/` | `__config/history.yaml` | any module code | ❌ hidden | ✅ | **Module-internal config dir** — one per module, no access restriction, files inside use plain names |

**`validateFilename` rules** (`DEFAULT_FILENAME_PATTERN = /^(?!_(?!_))[^/\\][^/\\]*$/`)**:**
- Single `_` prefix → **blocked** (assetdirs are created by vfslib internals, not user code)
- Double `__` prefix → **allowed** (`__config/` is the only conventional use)
- `.` prefix → allowed by `validateFilename`, restricted by `AccessController`

### Assetdir details

`_note.md/` is the assetdir for `note.md` — same parent directory, `_` + owner filename. Managed exclusively by `IAssetOperations` (`putAsset`, `getAsset`, etc.). The engine auto-renames/moves/deletes the assetdir when the owner file changes. Never create or rename assetdirs manually.

### `__config/` — module-internal config

Each module may have one `__config/` subdirectory for private metadata (history, caches, internal state). Files inside use **plain names** — no prefix needed:

```
chats/__config/history.yaml     ← prompt history
notes/__config/index.json       ← module-level index
```

`__config/` is accessible to any code (no `isSystem` requirement), excluded from default `getChildren` listings, and included in sync. It is NOT the same as the global `etc` module.

### Module-level system flag

Modules mounted with `isSystem: true` (e.g., `etc`, device modules):
- Can write `.` prefix paths (bypasses `AccessController`)
- Are **excluded from sync** entirely

User workspace modules (no `isSystem`) are synced in full, including their `__config/` dirs and assetdirs.

### `getChildren` options (all default `false`)

```ts
fs.getChildren(path, {
  includeHidden: true,       // include '.' prefix entries
  includeAssetDirs: true,    // include '_' prefix entries (single _ only)
  includeInternalDirs: true, // include '__config/' and other '__' prefix dirs
})
```

Used by: sync walker (all three `true`), `SystemFSExploreEditor` (all three `true`), normal UI (all `false`).

### System root directories

Bootstrap creates `/etc/`, `/dev/`, `/module/` at VFS root. Modules live under `/module/<name>/`. The `etc` module (`CONFIG_MODULE`) stores global config and is auto-mounted at init.

## Conventions

- **`vfs.write(moduleName, path, content)`** has upsert semantics — creates file and intermediate directories automatically. Prefer over check-then-create.
- **Avoid `exists` + `read` patterns** (TOCTOU) — just read and catch not-found errors.
- **Asset directories**: use `IAssetOperations.putAsset(ownerIdOrPath, filename, content)` — never create `_name/` dirs directly.
- **Module-internal data**: write to `/__config/<filename>` (plain filename, no `_` prefix). Any module can create `__config/` without `isSystem`.
- **`toBuffer(content)`** from `@itookit/vfslib` converts `string | ArrayBuffer | Uint8Array → ArrayBuffer`.
- **`etc` module** (`CONFIG_MODULE = 'etc'`) is auto-mounted at VFS init; stores LLM connections (`/llm/.connections/`), MCP configs (`/llm/.mcp/`), sync config, tags, contacts.
- **DB name** is `'MindOS-v2'` (IndexedDB). The old `'MindOS'` schema (v7) is incompatible.
- **Sync** (`apps/sync-server`, SQLite + local files): system modules (`isSystem: true`) excluded; all other modules synced including `__config/` dirs, assetdirs, and hidden files.
