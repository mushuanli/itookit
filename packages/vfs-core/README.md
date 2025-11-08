<think>

用户想要将 vfsCore 打包成一个通用的 npm 库。他们问了几个问题：

1. 是否应该将 `VFSCore.js` 重命名为 `index.js`？
2. 需要生成 `index.d.ts` TypeScript 类型定义
3. 移除对 configManager 的依赖（已经复制了 constants.js）
4. 检查 package.json 是否正确

让我逐一分析：

1. **重命名为 index.js**：是的，这是标准做法。主入口应该是 `index.js`，它会导出所有公共 API。

2. **index.d.ts**：需要生成完整的 TypeScript 类型定义文件。

3. **移除 configManager 依赖**：需要检查所有文件，确保不再依赖外部的 configManager。特别是：
   - `storage/db.js` - 需要独立的 Database 实现
   - `storage/VFSStorage.js` - 不应该从 configManager 导入
   - 所有其他文件

4. **package.json 检查**：
   - 名称：`@itookit/vfsCore` - 可能应该是小写 `@itookit/vfs-core`（npm 规范）
   - 描述需要更新
   - 缺少 `repository` 字段
   - 缺少测试脚本的实际实现
   - 可能需要添加 `engines` 字段

让我生成完整的方案。
</think>
# 将 VFSCore 打包为 npm 库

## 1. 重命名和结构调整

### ✅ 是的，应该重命名为 `index.js`

**当前结构改进：**

```bash
vfsCore/
├── package.json
├── README.md
├── LICENSE
├── src/
│   ├── index.js          # ← 重命名 VFSCore.js
│   ├── index.d.ts        # ← TypeScript 类型定义
│   ├── constants.js      # ← 已复制，需确保独立
│   ├── core/
│   ├── providers/
│   ├── registry/
│   ├── storage/
│   │   └── db.js         # ← 需要独立实现，不依赖外部
│   └── utils/
├── examples/             # ← 移到外层
│   ├── basic-usage.js
│   ├── custom-provider.js
│   └── ...
└── tests/               # ← 移到外层（或保持在 src/ 中）
    ├── integration/
    └── unit/
```

---

## 2. 创建主入口文件

### `src/index.js`

```javascript
/**
 * @fileoverview VFSCore - Virtual File System Manager
 * @module @itookit/vfs-core
 */

// 主类
export { VFSCore, getVFSManager } from './VFSCore.js';

// 核心类
export { VNode } from './core/VNode.js';
export { VFS } from './core/VFS.js';
export { PathResolver } from './core/PathResolver.js';

// 错误类
export {
    VFSError,
    VNodeNotFoundError,
    PathExistsError,
    NotDirectoryError,
    DirectoryNotEmptyError,
    ValidationError,
    PermissionError,
    ProviderError
} from './core/VFSError.js';

// Providers
export { ContentProvider } from './providers/base/ContentProvider.js';
export { PlainTextProvider } from './providers/PlainTextProvider.js';
export { SRSProvider } from './providers/SRSProvider.js';
export { TaskProvider } from './providers/TaskProvider.js';
export { AgentProvider } from './providers/AgentProvider.js';
export { LinkProvider } from './providers/LinkProvider.js';
export { CompositeProvider } from './providers/CompositeProvider.js';
export { ProviderFactory } from './providers/ProviderFactory.js';

// 注册表
export { ProviderRegistry } from './registry/ProviderRegistry.js';
export { ModuleRegistry, ModuleInfo } from './registry/ModuleRegistry.js';

// 存储
export { VFSStorage, VFS_STORES } from './storage/VFSStorage.js';
export { Database } from './storage/db.js';

// 工具
export { EventBus } from './utils/EventBus.js';
export { Cache } from './utils/Cache.js';
export { Transaction, TransactionManager } from './utils/Transaction.js';

// 常量
export { OBJECT_STORES, EVENTS } from './constants.js';
```

---

## 3. TypeScript 类型定义

### `src/index.d.ts`

```typescript
/**
 * @itookit/vfs-core TypeScript Definitions
 */

// ========== Core Types ==========

export interface VNodeOptions {
    id?: string;
    type: 'file' | 'directory' | 'symlink';
    module: string;
    name: string;
    parent?: string | null;
    contentType?: string;
    providers?: string[];
    meta?: VNodeMeta;
    contentRef?: string | null;
}

export interface VNodeMeta {
    size?: number;
    createdAt?: Date;
    modifiedAt?: Date;
    accessedAt?: Date;
    permissions?: string;
    owner?: string | null;
    tags?: string[];
    [key: string]: any;
}

export class VNode {
    id: string;
    type: 'file' | 'directory' | 'symlink';
    module: string;
    name: string;
    parent: string | null;
    contentType: string;
    providers: string[];
    meta: VNodeMeta;
    contentRef: string | null;
    
    constructor(options: VNodeOptions);
    
    isDirectory(): boolean;
    isFile(): boolean;
    isSymlink(): boolean;
    invalidateCache(): void;
    touch(): void;
    markModified(): void;
    toJSON(): object;
    clone(): VNode;
    getStat(): VNodeStat;
    
    static fromJSON(data: object): VNode;
}

export interface VNodeStat {
    id: string;
    type: 'file' | 'directory' | 'symlink';
    name: string;
    size: number;
    createdAt: Date;
    modifiedAt: Date;
    accessedAt: Date;
    permissions: string;
    contentType: string;
}

// ========== VFSCore ==========

export interface VFSManagerOptions {
    storage?: object;
    providers?: ContentProvider[];
    defaults?: {
        modules?: string[];
        [key: string]: any;
    };
}

export interface ReadResult {
    content: string;
    metadata: object;
}

export interface CreateFileOptions {
    contentType?: string;
    meta?: object;
}

export interface SearchCriteria {
    contentType?: string;
    type?: 'file' | 'directory';
    name?: string;
    tags?: string[];
}

export class VFSCore {
    storage: VFSStorage;
    vfs: VFS;
    events: EventBus;
    providerRegistry: ProviderRegistry;
    moduleRegistry: ModuleRegistry;
    initialized: boolean;
    
    static getInstance(): VFSCore;
    
    init(options?: VFSManagerOptions): Promise<void>;
    shutdown(): Promise<void>;
    
    // Module Management
    mount(name: string, options?: object): Promise<ModuleInfo>;
    unmount(name: string): Promise<void>;
    getModule(name: string): ModuleInfo | null;
    listModules(): string[];
    
    // Provider Management
    registerProvider(provider: ContentProvider): void;
    unregisterProvider(name: string): void;
    getProvider(name: string): ContentProvider | undefined;
    listProviders(): string[];
    
    // File Operations
    createFile(module: string, path: string, content?: string, options?: CreateFileOptions): Promise<VNode>;
    createDirectory(module: string, path: string, options?: object): Promise<VNode>;
    read(nodeId: string, options?: object): Promise<ReadResult>;
    write(nodeId: string, content: string, options?: object): Promise<VNode>;
    unlink(nodeId: string, options?: object): Promise<{ removedNodeId: string; allRemovedIds: string[] }>;
    move(nodeId: string, newPath: string): Promise<VNode>;
    copy(sourceId: string, targetPath: string): Promise<VNode>;
    readdir(nodeId: string, options?: object): Promise<VNode[]>;
    stat(nodeId: string): Promise<object>;
    getTree(module: string): Promise<VNode[]>;
    
    // Event Subscription
    on(event: string, callback: (data: any) => void): () => void;
    once(event: string, callback: (data: any) => void): () => void;
    off(event: string, callback: (data: any) => void): void;
    
    // Utilities
    getStats(): Promise<SystemStats>;
    exportModule(module: string): Promise<object>;
    importModule(data: object): Promise<void>;
    search(module: string, criteria: SearchCriteria): Promise<VNode[]>;
}

export function getVFSManager(): VFSCore;

// ========== Providers ==========

export interface ProviderOptions {
    priority?: number;
    capabilities?: string[];
}

export interface ReadResult {
    content: string | null;
    metadata: object;
}

export interface WriteResult {
    updatedContent: string;
    derivedData: object;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

export abstract class ContentProvider {
    name: string;
    priority: number;
    capabilities: string[];
    enabled: boolean;
    
    constructor(name: string, options?: ProviderOptions);
    
    canHandle(vnode: VNode): boolean;
    read(vnode: VNode, options?: object): Promise<ReadResult>;
    write(vnode: VNode, content: string, transaction: any): Promise<WriteResult>;
    validate(vnode: VNode, content: string): Promise<ValidationResult>;
    cleanup(vnode: VNode, transaction: any): Promise<void>;
    getStats(vnode: VNode): Promise<object>;
    onMove(vnode: VNode, oldPath: string, newPath: string, transaction: any): Promise<void>;
    onCopy(sourceVNode: VNode, targetVNode: VNode, transaction: any): Promise<void>;
    onEnable(): Promise<void>;
    onDisable(): Promise<void>;
    hasCapability(capability: string): boolean;
}

export class PlainTextProvider extends ContentProvider {}
export class SRSProvider extends ContentProvider {}
export class TaskProvider extends ContentProvider {}
export class AgentProvider extends ContentProvider {}
export class LinkProvider extends ContentProvider {}
export class CompositeProvider extends ContentProvider {}

export class ProviderFactory {
    static createBuiltInProviders(deps: { storage: VFSStorage; eventBus: EventBus }): ContentProvider[];
    static createMarkdownProvider(deps: { storage: VFSStorage; eventBus: EventBus }): CompositeProvider;
}

// ========== Registry ==========

export class ProviderRegistry {
    register(provider: ContentProvider): void;
    unregister(name: string): void;
    get(name: string): ContentProvider | undefined;
    has(name: string): boolean;
    getProvidersForNode(vnode: VNode): ContentProvider[];
    mapType(contentType: string, providerNames: string[]): void;
    getDefaultProviders(contentType: string): string[];
    getProviderNames(): string[];
    getAllProviders(): ContentProvider[];
    onHook(event: string, callback: (data: any) => void): () => void;
}

export class ModuleInfo {
    name: string;
    rootId: string | null;
    description: string;
    createdAt: Date;
    meta: object;
    
    constructor(name: string, options?: object);
    toJSON(): object;
    static fromJSON(data: object): ModuleInfo;
}

export class ModuleRegistry {
    register(name: string, options?: object): ModuleInfo;
    unregister(name: string): void;
    get(name: string): ModuleInfo | undefined;
    has(name: string): boolean;
    getModuleNames(): string[];
    update(name: string, updates: object): void;
}

// ========== Storage ==========

export const VFS_STORES: {
    VNODES: string;
    CONTENTS: string;
    MODULES: string;
    SRS_CLOZES: string;
    TASKS: string;
    AGENTS: string;
    LINKS: string;
    TAGS: string;
    NODE_TAGS: string;
};

export class VFSStorage {
    constructor(options?: object);
    connect(): Promise<void>;
    beginTransaction(storeNames?: string[], mode?: IDBTransactionMode): Promise<Transaction>;
    
    // VNode operations
    saveVNode(vnode: VNode, transaction?: Transaction): Promise<void>;
    loadVNode(nodeId: string): Promise<VNode | null>;
    deleteVNode(nodeId: string, transaction?: Transaction): Promise<void>;
    getNodeIdByPath(module: string, path: string): Promise<string | null>;
    getChildren(parentId: string): Promise<VNode[]>;
    loadVNodes(nodeIds: string[]): Promise<VNode[]>;
    
    // Content operations
    saveContent(nodeId: string, content: string, transaction?: Transaction): Promise<string>;
    loadContent(contentRef: string): Promise<string>;
    updateContent(contentRef: string, content: string, transaction?: Transaction): Promise<void>;
    deleteContent(contentRef: string, transaction?: Transaction): Promise<void>;
    
    // Module operations
    getModuleRoot(moduleName: string): Promise<VNode | null>;
    getModuleNodes(moduleName: string): Promise<VNode[]>;
}

export class Database {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getTransaction(stores: string | string[], mode?: IDBTransactionMode): Promise<IDBTransaction>;
    getAllByIndex(storeName: string, indexName: string, query: any): Promise<any[]>;
}

// ========== Utils ==========

export class EventBus {
    on(event: string, callback: (data: any) => void): () => void;
    once(event: string, callback: (data: any) => void): () => void;
    off(event: string, callback: (data: any) => void): void;
    emit(event: string, data: any): void;
    clear(event?: string): void;
    listenerCount(event: string): number;
    eventNames(): string[];
}

export class Cache {
    constructor(maxSize?: number);
    get(key: string): any;
    set(key: string, value: any): void;
    has(key: string): boolean;
    delete(key: string): void;
    invalidate(key: string): void;
    clear(): void;
    size(): number;
    keys(): string[];
}

export class Transaction {
    constructor(idbTransaction: IDBTransaction);
    getStore(storeName: string): IDBObjectStore;
    log(type: string, data: object): void;
    commit(): Promise<void>;
    rollback(): void;
    getStats(): object;
}

export class TransactionManager {
    constructor(db: Database);
    begin(storeNames: string[], mode?: IDBTransactionMode): Promise<Transaction>;
    getActiveCount(): number;
}

// ========== Errors ==========

export class VFSError extends Error {
    code: string;
    constructor(message: string, code?: string);
}

export class VNodeNotFoundError extends VFSError {
    nodeId: string;
    constructor(nodeId: string);
}

export class PathExistsError extends VFSError {
    path: string;
    constructor(path: string);
}

export class NotDirectoryError extends VFSError {
    path: string;
    constructor(path: string);
}

export class DirectoryNotEmptyError extends VFSError {
    path: string;
    constructor(path: string);
}

export class ValidationError extends VFSError {
    errors: string[];
    constructor(message: string, errors?: string[]);
}

export class PermissionError extends VFSError {
    operation: string;
    path: string;
    constructor(operation: string, path: string);
}

export class ProviderError extends VFSError {
    providerName: string;
    constructor(providerName: string, message: string);
}

// ========== Additional Types ==========

export interface SystemStats {
    modules: Record<string, ModuleStats>;
    providers: string[];
    totalNodes: number;
    totalFiles: number;
    totalDirectories: number;
}

export interface ModuleStats {
    nodeCount: number;
    files: number;
    directories: number;
}

export const OBJECT_STORES: any[];
export const EVENTS: Record<string, string>;
```

---

## 4. 修正后的 package.json

```json
{
  "name": "@itookit/vfs-core",
  "version": "1.0.0",
  "description": "A powerful virtual file system manager with plugin architecture for browser-based applications using IndexedDB",
  "main": "src/index.js",
  "module": "src/index.js",
  "type": "module",
  "types": "src/index.d.ts",
  "exports": {
    ".": {
      "import": "./src/index.js",
      "types": "./src/index.d.ts"
    }
  },
  "files": [
    "src",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "type-check": "tsc --noEmit",
    "prepublishOnly": "npm run test"
  },
  "keywords": [
    "vfs",
    "virtual-file-system",
    "indexeddb",
    "file-manager",
    "content-provider",
    "plugin-architecture",
    "browser-storage",
    "note-taking",
    "srs",
    "task-management",
    "typescript"
  ],
  "author": "lizlok@gmail.com",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/vfs-core.git"
  },
  "bugs": {
    "url": "https://github.com/yourusername/vfs-core/issues"
  },
  "homepage": "https://github.com/yourusername/vfs-core#readme",
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=16.0.0"
  },
  "dependencies": {
    "@itookit/common": "workspace:*",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/uuid": "^10.0.0",
    "@vitest/coverage-v8": "^1.0.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  }
}
```

**主要改进：**
- ✅ 名称改为小写 `vfs-core`（npm 规范）
- ✅ 更新了描述
- ✅ 添加了完整的测试脚本
- ✅ 添加了 repository、bugs、homepage 字段
- ✅ 添加了 engines 限制
- ✅ license 改为 MIT（更常用）
- ✅ 添加了更多关键词

---

## 5. 创建 README.md

```markdown
# @itookit/vfs-core

A powerful Virtual File System (VFS) manager with plugin architecture for browser-based applications using IndexedDB.

## Features

- 🗂️ **Virtual File System**: Complete file system abstraction with directories and files
- 🔌 **Plugin Architecture**: Extensible content providers for different file types
- 📦 **IndexedDB Storage**: Persistent browser storage with transactional support
- 🔄 **Content Processing**: Automatic parsing and management of SRS cards, tasks, agents, and links
- 📡 **Event System**: Subscribe to file system changes and content updates
- 🎯 **TypeScript Support**: Full TypeScript definitions included
- 🧩 **Modular Design**: Organize content in separate modules/namespaces

## Installation

```bash
npm install @itookit/vfs-core
```

## Quick Start

```javascript
import { getVFSManager } from '@itookit/vfs-core';

// Initialize VFS
const vfs = getVFSManager();
await vfs.init();

// Create a file
const note = await vfs.createFile(
    'notes',
    '/getting-started.md',
    '# Hello VFS\n{{c1::What is VFS?}}'
);

// Read the file
const { content, metadata } = await vfs.read(note.id);
console.log('Content:', content);
console.log('SRS Cards:', metadata.clozes);

// Update the file
await vfs.write(note.id, '# Updated Content');

// Delete the file
await vfs.unlink(note.id);
```

## Core Concepts

### Modules
Modules are namespaces that organize your files:

```javascript
await vfs.mount('notes', { description: 'My notes' });
await vfs.mount('tasks', { description: 'My tasks' });
```

### Content Providers
Providers process different content types:

- **PlainTextProvider**: Basic text files
- **SRSProvider**: Spaced repetition cards `{{c1::content}}`
- **TaskProvider**: Tasks `- [ ] @user Task`
- **AgentProvider**: AI agents ` ```agent:type`
- **LinkProvider**: Bidirectional links `[[node-id]]`

### Custom Providers

```javascript
import { ContentProvider } from '@itookit/vfs-core';

class MyProvider extends ContentProvider {
    constructor() {
        super('my-provider', { priority: 5 });
    }
    
    async read(vnode, options) {
        return { content: null, metadata: {} };
    }
    
    async write(vnode, content, transaction) {
        // Process content
        return { updatedContent: content, derivedData: {} };
    }
}

vfs.registerProvider(new MyProvider());
```

## API Reference

See [TypeScript definitions](./src/index.d.ts) for complete API documentation.

## License

MIT
```

---

## 6. 检查并移除 configManager 依赖

### 需要修改的文件：

#### `src/storage/db.js`

确保这是一个**完全独立**的实现：

```javascript
/**
 * @fileoverview Database - IndexedDB wrapper (standalone)
 */

import { OBJECT_STORES } from '../constants.js';

const DB_NAME = 'VFSDatabase';
const DB_VERSION = 1;

export class Database {
    constructor() {
        this.db = null;
        this.dbName = DB_NAME;
        this.version = DB_VERSION;
    }
    
    async connect() {
        // 完整的独立实现...
    }
    
    // ... 其他方法
}
```

#### `src/storage/VFSStorage.js`

确保从本地导入：

```javascript
import { Database } from './db.js'; // ✅ 本地导入
// import { Database } from '../../configManager/db.js'; // ❌ 删除这行
```

---

## 7. 发布清单

```bash
# 1. 重命名文件
mv src/VFSCore.js src/index.js

# 2. 创建必要文件
# - index.d.ts (已提供)
# - README.md (已提供)
# - LICENSE

# 3. 更新 package.json (已提供)

# 4. 测试
npm test

# 5. 构建检查
npm run type-check

# 6. 发布到 npm
npm publish
```
