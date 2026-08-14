# agent.md — Project Context for AI Assistants

> Quick reference for AI agents working in this repository. For authoritative detail see `CLAUDE.md`.

---

## 1. Project Overview

**itookit** — pnpm monorepo powering **MindOS**, a browser-based personal knowledge OS with a virtual filesystem, markdown editor, and LLM chat/agent execution.

- Package manager: `pnpm@10.20.0` (workspace protocol `workspace:*`)
- Language: TypeScript 5.9, strict mode, `target: ES2022`, `moduleResolution: bundler`
- No framework (Vanilla TS throughout — no React, no Vue)

---

## 2. Tech Stack

| Category | Technology |
|---|---|
| Build (app) | Vite 5/7 |
| Build (libs) | tsup (CJS+ESM+.d.ts) or vite build (UI libs) |
| Testing | Vitest |
| Editor | CodeMirror 6 |
| Storage (browser) | IndexedDB via Dexie 4 |
| Storage (Node) | better-sqlite3 |
| Markdown | marked 16, turndown, gray-matter, front-matter |
| Diagrams | Mermaid 11 |
| State mutation | immer 10 |
| YAML | js-yaml, yaml |
| Icons | Font Awesome 7 |

---

## 3. Workspace Structure

```
/
├── apps/
│   └── web-app/          (mind-os) — main browser SPA (Vite, noEmit tsc)
│   └── tauri-app/          (mind-os) — main tauri APP (Vite, noEmit tsc)
├── packages/
│   ├── common/           (@itookit/common)            — shared interfaces & types, zero deps
│   ├── vfslib/           (@itookit/vfslib)             — VFS engine core
│   ├── vfsdriver-indexeddb/  (@itookit/vfsdriver-indexeddb) — browser IDB backend
│   ├── vfsdriver-localfs/    (@itookit/vfsdriver-localfs)   — Node/Electron SQLite+FS backend
│   ├── vfsdriver-fs/         (@itookit/vfsdriver-fs)        — alternative SQLite backend
│   ├── device-llm/       (@itookit/device-llm)         — LLM API: OpenAI/Anthropic/Gemini, SSE, MCP
│   ├── llm-kernel/       (@itookit/llm-kernel)         — Executor + Orchestrator engine, no UI
│   ├── llm-runtime/       (@itookit/llm-programs)         — session mgmt, VFS persistence (.chat files)
│   ├── mdx/              (@itookit/mdxeditor)          — CodeMirror 6 markdown editor
│   ├── llm-ui/           (@itookit/llm-ui)             — Chat & Agent UI components
│   ├── vfs-ui/           (@itookit/vfs-ui)             — file-tree UI shell (VFSUIShell)
│   ├── memory-manager/   (@itookit/memory-manager)     — top-level workspace container
│   ├── app-settings/     (@itookit/app-settings)       — settings module + SettingsEngine
│   ├── app-shell/        (@itookit/app-shell)          — workspace strategy wiring
│   └── demo/             (@itookit/demo)               — standalone demo app
└── scripts/
    └── vite-lib.config.ts  — shared createLibConfig() helper for UI lib builds
```

### apps/web-app/src/ (intentionally minimal)

```
src/
├── config/modules.ts   — WORKSPACES array (workspace definitions + strategies)
├── main.ts             — entry point
└── styles/             — global CSS
```

All logic lives in packages. The app only wires strategies.

---

## 4. Core Abstractions

### 4.1 VFS Layer

```
IStorageBackend  (IndexedDB / SQLite+FS)
    ↕
VFSEngine        — PathResolver, AccessController, EventBus, PluginPipeline
    ↕
VFSManager (IVFSManager)  — module lifecycle coordinator
    ↕
ModuleFS (IModuleFS)      — chroot-isolated view per module
    ↕ optional sub-interfaces
ITagOperations, IAssetOperations, ISeqFileOperations, IRefOperations, IWatchOperations
```

**Rules:**
- Callers always type VFS deps as `IVFSManager` or `IModuleFS` — never concrete classes
- Concrete wiring (`createVFS()`) only in `apps/web-app/src/services/vfs.ts`
- Each module's `/` maps to `/module/<name>/` in the system tree
- Bootstrap creates `/etc/`, `/dev/`, `/module/` at root
- `etc` module (`CONFIG_MODULE`) auto-mounted at init; stores LLM connections, MCP configs, sync config

### 4.2 ISessionEngine — UI/Backend Contract

Single interface used by all UI packages (`packages/common/src/interfaces/ISessionEngine.ts`).

Two main implementations:
- **`VFSModuleEngine`** (`packages/vfslib/src/adapter-session/`) — standard file workspaces
- **`LLMSessionEngine`** (`packages/llm-runtime/src/persistence/`) — chat sessions as `.chat` files

Services needing direct VFS access extend **`BaseModuleService`** — provides `readJson`/`writeJson` (upsert), `ensureDirectory`, `engine: VFSModuleEngine`.

### 4.3 Workspace Strategy Pattern (web-app)

```ts
interface WorkspaceStrategy {
    getFactory(): EditorFactory;
    getEngine(moduleName: string): ISessionEngine;
}
```

Four strategies in `packages/app-shell/src/strategies/`:
- `StandardWorkspaceStrategy` — MDxEditor + VFSModuleEngine
- `ChatWorkspaceStrategy` — LLMSessionEngine
- `AgentWorkspaceStrategy`
- `SettingsWorkspaceStrategy`

Adding a workspace = add entry to `WORKSPACES` in `apps/web-app/src/config/modules.ts`.

### 4.4 LLM Engine Stack

```
device-llm   →  LLMConnection / SSE streaming / MCP / multi-provider (OpenAI, Anthropic, Gemini)
llm-kernel   →  Executor (Agent/HTTP/Tool/Script) + Orchestrator (Serial/Parallel/Router/Loop/DAG)
llm-runtime   →  SessionManager, LLMSessionEngine, VFSAgentService, PromptHistoryService
llm-ui       →  Chat UI components, Agent config editors
```

Entry point: `initializeLLMEngine(options)` in `packages/llm-runtime/src/index.ts`.

---

## 5. VFS Path & Naming Conventions

| Prefix | Example | Creator | Listed by default | Notes |
|---|---|---|---|---|
| `name` | `notes.md`, `folder/` | user | ✅ | Normal files |
| `.name` | `.connections/` | `isSystem` modules only | ❌ | AccessController-restricted |
| `_name/` | `_note.md/` | vfslib internals | ❌ | Assetdir — auto-managed, never create manually |
| `__config/` | `__config/history.yaml` | any module | ❌ | Module-internal config, plain names inside |

**`validateFilename`**: single `_` prefix blocked; `__` prefix allowed; `.` prefix allowed but access-controlled.

**`getChildren` options** (all default `false`): `includeHidden`, `includeAssetDirs`, `includeInternalDirs`.

---

## 6. Chat Persistence Format

Each `.chat` file = `ChatManifest` JSON:
```
{ branches: Record<branchName, headNodeId> }
```
Messages stored as `/.{sessionId}/.{nodeId}.json` (hidden dirs inside chat module).

---

## 7. FSNode Types

Discriminated union: `FSNode = FSFileNode | FSDirectoryNode | FSSeqFileNode | FSDeviceNode | FSSymlinkNode` — all fields `readonly`. Always type-narrow before accessing type-specific fields. `FSFileNode` carries `size` and `assetDirId`; others do not.

---

## 8. Event System

- `IModuleFS` extends `FSEventEmitter` — `on(eventType, cb): () => void` (returns unsubscriber)
- `IVFSManager` typed `on<E extends VFSManagerEventType>(...)` for: `node:created`, `node:updated`, `node:deleted`, `module:mounted`, `module:unmounted`
- `node:deleted` payload has `nodeIds[]` + `moduleId` but **no `path`** field

---

## 9. Build System

| Package type | Build tool | Output |
|---|---|---|
| Logic-only (`common`, `vfslib`, `device-llm`, `llm-kernel`, vfsdrivers) | tsup | CJS + ESM + `.d.ts` |
| UI libs (`vfs-ui`, `llm-ui`, `mdx`, `memory-manager`, `app-settings`) | vite build | ESM + `.d.ts` via vite-plugin-dts |
| Main app (`web-app`) | Vite 5 | Browser bundle |

Shared lib config: `scripts/vite-lib.config.ts` → `createLibConfig({ name, fileName, rootDir, external, globals })`.

TypeScript base: `tsconfig.base.json` at repo root — all packages `extends: "../../tsconfig.base.json"`.

---

## 10. Key Commands

```bash
pnpm dev                                          # Vite dev server (web-app)
pnpm build                                        # Build all packages (recursive)
pnpm build:libs                                   # Build packages/* only
pnpm typecheck                                    # All packages (recursive)
pnpm --filter @itookit/vfslib test --run          # Run vfslib tests once
cd packages/vfslib && npx vitest run src/__tests__/04-tag-ops.test.ts  # Single test file
pnpm --filter @itookit/vfslib build               # Build single package
```

---

## 11. Coding Conventions

- **VFS writes** use `vfs.write(moduleName, path, content)` — upsert semantics, creates intermediate dirs automatically
- **Avoid `exists` + `read` patterns** (TOCTOU) — read and catch not-found
- **Asset directories**: use `IAssetOperations.putAsset(ownerIdOrPath, filename, content)` — never create `_name/` directly
- **Module-internal data**: write to `/__config/<filename>` (plain name, no `_` prefix)
- **Content conversion**: `toBuffer(content)` from `@itookit/vfslib` — `string | ArrayBuffer | Uint8Array → ArrayBuffer`
- **DB name**: `'MindOS-v2'` (IndexedDB) — `'MindOS'` (v7) is incompatible
- **Sync**: system modules (`isSystem: true`) excluded; user modules synced including `__config/`, assetdirs, hidden files
- **Backup/restore/export/import**: live on `vfs.maintenance.*`, not on `vfs` directly

---

## 12. Package Dependency Rules

```
common        ← no internal deps (zero runtime deps)
vfslib        ← common
vfsdrivers    ← common
device-llm    ← common
llm-kernel    ← common
llm-runtime    ← common, llm-kernel, vfslib
mdx           ← common
vfs-ui        ← common
llm-ui        ← common, llm-runtime, mdx
memory-manager← common, mdx, vfs-ui, vfslib
app-settings  ← common, device-llm, llm-runtime, llm-ui, memory-manager
app-shell     ← all of the above
web-app (app) ← all packages
```

UI packages declare internal packages as `peerDependencies` (not `dependencies`) to avoid bundling duplicates.

---

## 13. Testing

- Only `vfslib` has a full test suite (`packages/vfslib/tests/01-*.test.ts` … `16-*.test.ts`)
- Test runner: **Vitest**
- `fake-indexeddb` used for browser storage emulation in Node test environment
- `app-shell` also has tests in `tests/`
