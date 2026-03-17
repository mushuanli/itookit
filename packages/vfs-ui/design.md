

```markdown
# VFS-UI Architecture Design Document

> **Version**: 2.0  
> **Last Updated**: 2025-01  
> **Status**: Active  
> **Scope**: This document governs all development within the `vfs-ui/` package.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Layer Definitions & Rules](#2-layer-definitions--rules)
3. [Dependency Rules](#3-dependency-rules)
4. [Directory Structure](#4-directory-structure)
5. [Data Flow](#5-data-flow)
6. [Command System](#6-command-system)
7. [Event System](#7-event-system)
8. [State Management](#8-state-management)
9. [Component Development Guide](#9-component-development-guide)
10. [Adding New Features](#10-adding-new-features)
11. [Interface Modification Rules](#11-interface-modification-rules)
12. [Testing Strategy](#12-testing-strategy)
13. [Anti-Patterns & Constraints](#13-anti-patterns--constraints)
14. [Decision Log](#14-decision-log)

---

## 1. Architecture Overview

VFS-UI uses a **four-layer architecture** combining Flux unidirectional data flow,
Clean Architecture port isolation, and the Command Pattern for intent expression.

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Contracts (Domain)                                │
│  Types, Commands, Events, Port Interfaces                   │
│  ⚠️ ZERO internal dependencies                              │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Services (Data)                                   │
│  VFSStore, VFSService, FileTypeRegistry,                    │
│  NodeMapper, EngineAdapter, StatePersistence                │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Interaction (Commands)                            │
│  CommandBus, EventBus, Command Handlers                     │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Presentation + Shell                              │
│  UI Components (consume ports only)                         │
│  Assembler (Composition Root, creates concrete instances)   │
│  VFSUIShell (Facade, holds port references only)            │
└─────────────────────────────────────────────────────────────┘
```

### Design Principles Applied

| Principle | Application |
|-----------|-------------|
| **SRP** | Each handler/service has exactly one reason to change |
| **OCP** | New file types via `FileTypeRegistry.register()`, new commands via `CommandMap` |
| **LSP** | All port implementations are substitutable |
| **ISP** | Components depend on minimal interfaces (`ICommandPort`, not full `CommandBus`) |
| **DIP** | Runtime logic depends on port interfaces, not concrete classes |
| **DRY** | Shared logic in `utils/`, common templates in `templates.ts` |
| **KISS** | Flat handler structure, no unnecessary abstraction layers |
| **YAGNI** | No per-component port interfaces; single `IStatePort`/`ICommandPort` suffices |
| **LoD** | Components never reach through objects; use commands instead |

---

## 2. Layer Definitions & Rules

### Layer 1: Contracts (`contracts/`)

**Purpose**: Define the language of the system. All types, interfaces, and
command/event schemas live here.

**Rules**:
- ❌ MUST NOT import from any other `vfs-ui/` directory
- ❌ MUST NOT import from `@itookit/common` except shared primitive types
  (`Heading`, `TaskCounts`, `EditorFactory`)
- ✅ MAY be imported by ALL other layers
- ✅ Changes here are **breaking** — require review of all consumers

**Files**:

| File | Contents |
|------|----------|
| `types.ts` | `VFSNodeUI`, `VFSUIState`, `UISettings`, `TagInfo`, `MenuItem`, etc. |
| `commands.ts` | `CommandMap` — all typed internal commands |
| `events.ts` | `PublicEventMap` — all typed outbound events |
| `ports.ts` | `IStatePort`, `ICommandPort`, `IEventPort`, `IDataOperationPort`, `IFileTypePort` |

### Layer 2: Services (`services/`)

**Purpose**: Implement data operations, state management, and engine integration.

**Rules**:
- ✅ MAY import from `contracts/` and `utils/`
- ❌ MUST NOT import from `interaction/`, `ui/`, or `shell/`
- ✅ MUST implement port interfaces from `contracts/ports.ts`
- ✅ Each service should have a single, well-defined responsibility

**Files**:

| File | Implements | Responsibility |
|------|-----------|----------------|
| `VFSStore.ts` | `IStatePort` | Immutable state container (Immer-based) |
| `VFSService.ts` | `IDataOperationPort` | Engine mutation wrapper |
| `FileTypeRegistry.ts` | `IFileTypePort` | File type → icon/editor/parser resolution |
| `NodeMapper.ts` | (pure functions) | `EngineNode` → `VFSNodeUI` transformation |
| `EngineAdapter.ts` | — | Engine events → Store dispatches (bridge) |
| `StatePersistence.ts` | — | localStorage save/restore of UI state |

### Layer 3: Interaction (`interaction/`)

**Purpose**: Translate typed commands into service calls and state mutations.

**Rules**:
- ✅ MAY import from `contracts/` and `utils/`
- ✅ MAY receive service instances via constructor injection (as port interfaces)
- ❌ MUST NOT import from `ui/` or `shell/`
- ❌ MUST NOT directly manipulate DOM
- ✅ Each handler should handle one domain of commands

**Files**:

| File | Commands Handled |
|------|-----------------|
| `CommandBus.ts` | Implements `ICommandPort` |
| `EventBus.ts` | Implements `IEventPort` |
| `handlers/FileCommandHandler.ts` | `file:create`, `file:delete`, `file:rename`, `file:move`, `file:updateTags` |
| `handlers/NavigationCommandHandler.ts` | `nav:selectSession`, `nav:toggleFolder`, `nav:navigateToHeading` |
| `handlers/UICommandHandler.ts` | `ui:toggleSidebar`, `ui:updateSettings`, `ui:startCreating`, `ui:cancelCreating`, `ui:updateSearch`, `ui:toggleOutline`, `ui:toggleOutlineH1` |
| `handlers/SelectionCommandHandler.ts` | `selection:update`, `selection:clear`, `selection:selectAll` |
| `handlers/BulkCommandHandler.ts` | `bulk:delete`, `bulk:move`, `move:start`, `move:end` |
| `handlers/ImportCommandHandler.ts` | `file:import` |
| `handlers/CustomMenuCommandHandler.ts` | `custom:menuAction` → forwards to `EventBus` |

### Layer 4: Presentation (`ui/`) + Shell (`shell/`)

**Presentation Rules**:
- ✅ MAY import from `contracts/` and `utils/`
- ✅ Receives `IStatePort` and `ICommandPort` via constructor
- ❌ MUST NOT import from `services/` or `interaction/` directly
- ❌ MUST NOT call `engine` methods directly
- ✅ All user intents MUST be expressed as typed commands

**Shell Rules**:
- `Assembler.ts` is the **Composition Root** — the ONLY place that imports
  all concrete classes and wires them together
- `VFSUIShell.ts` is the **Facade** — holds port interfaces for runtime,
  receives assembled parts from `Assembler`
- ✅ Shell MAY import concrete UI classes (for `init()` calls)
- ✅ Shell MAY import `VFSService` directly (required by `ISessionUI` generic)

---

## 3. Dependency Rules

### Allowed Import Matrix

```
                 contracts  utils  services  interaction  ui  shell
contracts           —        ❌      ❌         ❌        ❌    ❌
utils               ✅        —      ❌         ❌        ❌    ❌
services            ✅       ✅       —         ❌        ❌    ❌
interaction         ✅       ✅      ✅*         —        ❌    ❌
ui                  ✅       ✅      ❌         ❌         —    ❌
shell               ✅       ✅      ✅         ✅        ✅     —
mention             ✅†      ✅      ❌         ❌        ❌    ❌
integrations        ✅       ✅      ❌         ❌        ❌    ❌

* interaction → services: ONLY via port interfaces (constructor injection)
† mention → contracts: ONLY types.ts (not commands/events/ports)
```

### Enforcement Checklist

Before merging any PR, verify:

1. `contracts/` files have NO `import` from `services/`, `interaction/`, `ui/`, `shell/`
2. `ui/` files have NO `import` from `services/` or `interaction/`
3. `interaction/` files have NO `import` from `ui/` or `shell/`
4. Only `shell/Assembler.ts` uses `new` for service/handler classes
5. `VFSUIShell.ts` field types are all `I*Port` interfaces (except `VFSService`)

---

## 4. Directory Structure

```
vfs-ui/
├── contracts/                          # Layer 1: Domain
│   ├── types.ts                        # Core types (VFSNodeUI, UISettings, etc.)
│   ├── commands.ts                     # CommandMap type definition
│   ├── events.ts                       # PublicEventMap type definition
│   └── ports.ts                        # Port interfaces
│
├── services/                           # Layer 2: Data
│   ├── VFSStore.ts                     # IStatePort implementation
│   ├── VFSService.ts                   # IDataOperationPort implementation
│   ├── FileTypeRegistry.ts            # IFileTypePort implementation
│   ├── NodeMapper.ts                   # Pure mapping functions
│   ├── EngineAdapter.ts                # Engine ↔ Store bridge
│   └── StatePersistence.ts             # UI state persistence
│
├── interaction/                        # Layer 3: Commands
│   ├── CommandBus.ts                   # ICommandPort implementation
│   ├── EventBus.ts                     # IEventPort implementation
│   └── handlers/
│       ├── FileCommandHandler.ts
│       ├── NavigationCommandHandler.ts
│       ├── UICommandHandler.ts
│       ├── SelectionCommandHandler.ts
│       ├── BulkCommandHandler.ts
│       ├── ImportCommandHandler.ts
│       └── CustomMenuCommandHandler.ts
│
├── ui/                                 # Layer 4a: Presentation
│   ├── core/
│   │   └── BaseComponent.ts            # Abstract base (IStatePort + ICommandPort)
│   └── components/
│       ├── FileOutline/
│       │   └── FileOutline.ts
│       ├── MoveToModal/
│       │   └── MoveToModal.ts
│       ├── TagEditor/
│       │   └── TagEditorComponent.ts
│       └── NodeList/
│           ├── NodeList.ts
│           ├── NodeListState.ts
│           ├── NodeListRenderer.ts
│           ├── Footer.ts
│           ├── templates.ts
│           ├── items/
│           │   ├── BaseNodeItem.ts
│           │   ├── FileItem.ts
│           │   ├── DirectoryItem.ts
│           │   └── itemTemplates.ts
│           ├── handlers/
│           │   ├── SelectionHandler.ts
│           │   ├── DragDropHandler.ts
│           │   ├── ItemActionHandler.ts
│           │   └── ContextMenuHandler.ts
│           └── popovers/
│               ├── SettingsPopover.ts
│               └── TagEditorPopover.ts
│
├── shell/                              # Layer 4b: Assembly
│   ├── Assembler.ts                    # Composition Root (creates all instances)
│   ├── VFSUIShell.ts                   # Facade (public API, holds interfaces)
│   └── index.ts                        # Package entry point
│
├── integrations/
│   └── editor-connector.ts            # Editor lifecycle bridge
│
├── mention/                            # Independent module
│   ├── BaseMentionSource.ts
│   ├── FileMentionSource.ts
│   ├── DirectoryMentionSource.ts
│   └── EngineTagSource.ts
│
├── utils/                              # Pure utilities (zero internal deps)
│   ├── helpers.ts
│   └── parser.ts
│
├── styles/
│   └── index.css
│
└── index.ts                            # Re-exports from shell/index.ts
```

---

## 5. Data Flow

### Unidirectional Flow (Runtime)

```
User Action
    │
    ▼
UI Component (click/drag/input)
    │
    │  commandBus.execute('file:create', { ... })
    ▼
CommandBus (ICommandPort)
    │
    │  dispatches to registered handler
    ▼
Command Handler (e.g., FileCommandHandler)
    │
    ├──→ VFSService.createFile()          [async engine mutation]
    │         │
    │         ▼
    │    ISessionEngine                    [external, fires events]
    │         │
    │         ▼
    │    EngineAdapter.handleEvent()       [engine event listener]
    │         │
    │         ▼
    └──→ Store.dispatch({ type, payload }) [state mutation]
              │
              ▼
         VFSStore (Immer produce)
              │
              │  notifies subscribers
              ▼
         BaseComponent.update()
              │
              │  transformState() → render()
              ▼
         DOM Updated
```

### Public Event Flow (Outbound)

```
Store state change
    │
    ▼
VFSUIShell.connectStoreToPublicEvents()
    │
    │  detects activeId change, sidebar change, etc.
    ▼
EventBus.emit('sessionSelected', { item })
    │
    ▼
External Consumer (via vfsManager.on('sessionSelected', callback))
```

### Key Invariant

> **Commands flow IN** (user → system). **Events flow OUT** (system → consumer).
> Never mix the two. Components MUST NOT listen to public events.

---

## 6. Command System

### Adding a New Command

**Step 1**: Define the command type in `contracts/commands.ts`:

```typescript
// contracts/commands.ts
export interface CommandMap {
  // ... existing commands ...

  // NEW: Add your command here
  'file:duplicate': { itemId: string; newTitle?: string };
}
```

**Step 2**: Create or extend a handler in `interaction/handlers/`:

```typescript
// interaction/handlers/FileCommandHandler.ts
private register(): void {
  this.unsubs.push(
    // ... existing handlers ...

    this.commandBus.on('file:duplicate', async ({ itemId, newTitle }) => {
      const node = await this.service.findItemById(itemId);
      if (!node) return;
      await this.service.createFile({
        title: newTitle || `${node.name} (copy)`,
        parentId: node.parentId,
        content: await this.engine.readContent(itemId),
      });
    }),
  );
}
```