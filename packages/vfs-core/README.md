
# VFS — 虚拟文件系统接口

一套面向 AI 应用场景的虚拟文件系统接口规范。提供从底层存储后端到上层模块应用的完整抽象，支持多后端挂载、模块隔离、设备驱动、插件扩展和跨后端同步。

> ⚠️ **本文档部分章节已过时（v4.1 之前的 ino 三层描述）**。当前 API 以 `packages/vfs-core/src/` 与 `packages/vfs-core/CLAUDE.md` 为准：存储后端为单一 path-based `IStorageBackend`（`stat/list/mkdir/delete/rename/read/write/updateMetadata/setTags` + 可选 `records?/search?/symlink?/transaction?`），已移除 `IInodeStore/IMetaStore/IContentStore` 三层、`runInTransaction` 与 `descriptor.features`。字段名亦已变更（`parentIdOrPath`→`parentPath`、`assetDirId`→`assetDirPath` 等）。

---

## 目录

- [架构概览](#架构概览)
- [目录结构](#目录结构)
- [核心概念](#核心概念)
  - [文件类型](#文件类型)
  - [目录布局与访问规则](#目录布局与访问规则)
  - [AssetDir 资产目录](#assetdir-资产目录)
  - [文件命名规则](#文件命名规则)
  - [能力声明](#能力声明)
  - [乐观并发控制](#乐观并发控制)
- [上层应用开发指南](#上层应用开发指南)
  - [获取模块文件系统](#获取模块文件系统)
  - [基础文件操作](#基础文件操作)
  - [SeqFile 操作](#seqfile-操作)
  - [资产目录操作](#资产目录操作)
  - [标签操作](#标签操作)
  - [双向引用](#双向引用)
  - [设备文件](#设备文件)
  - [事务](#事务)
  - [事件监听](#事件监听)
  - [搜索](#搜索)
  - [链接](#链接)
  - [能力检查](#能力检查)
- [底层存储开发指南](#底层存储开发指南)
  - [最小实现：IStorageBackend](#最小实现istoragebackend)
  - [三层存储接口](#三层存储接口)
  - [事务支持](#事务支持)
  - [可选增强：IRecordStore](#可选增强irecordstore)
  - [可选增强：IHighLevelStore](#可选增强ihighlevelstore)
  - [可选增强：ISyncableStore](#可选增强isyncablestore)
  - [后端实现清单](#后端实现清单)
- [挂载系统](#挂载系统)
  - [基本用法](#基本用法)
  - [路径解析规则](#路径解析规则)
  - [跨挂载点操作](#跨挂载点操作)
- [同步系统](#同步系统)
  - [同步架构](#同步架构)
  - [配置同步目标](#配置同步目标)
  - [冲突解决](#冲突解决)
- [插件开发指南](#插件开发指南)
- [设备驱动开发指南](#设备驱动开发指南)
- [系统管理](#系统管理)
  - [IVFSManager](#ivfsmanager)
  - [配置服务](#配置服务)
  - [维护操作](#维护操作)
- [工厂与初始化](#工厂与初始化)
- [错误处理](#错误处理)
- [设计决策](#设计决策)

---

## 架构概览

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        消费者层                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐     │
│  │ AI Agent     │  │ Module X     │  │ System Admin           │     │
│  │ (IModuleFS)  │  │ (IModuleFS)  │  │ (IVFSManager)          │     │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────────┘     │
├─────────┴─────────────────┴──────────────────────┴───────────────────┤
│                    服务层 (services/)                                 │
│  IModuleFS ─── 模块文件操作（chroot 隔离）                           │
│  IVFSManager ─ 模块生命周期 + 挂载 + 跨模块                         │
│  IConfigService ─ 配置管理                                           │
├──────────────────────────────────────────────────────────────────────┤
│                    基础设施层                                         │
│  MountRouter · PluginManager · DeviceManager · SyncService · Events │
├──────────────────────────────────────────────────────────────────────┤
│                    存储层 (storage/)                                  │
│  IStorageBackend ─── 必须实现                                        │
│  ├── IInodeStore    (Layer 1: 结构)                                  │
│  ├── IMetaStore     (Layer 2: 描述)                                  │
│  ├── IContentStore  (Layer 3: 内容)                                  │
│  └── 可选增强                                                        │
│      ├── IRecordStore    (SeqFile 原生操作)                           │
│      ├── IHighLevelStore (远程后端聚合)                               │
│      └── ISyncableStore  (变更日志)                                   │
├──────────────────────────────────────────────────────────────────────┤
│  SQLite │ IndexedDB │ S3 │ PostgreSQL │ Memory │ ...                 │
└─────────────────────────────────────────────────────────────────────┘
```

**核心原则：** 上层模块通过 `IModuleFS` 操作文件，完全不感知底层使用的是 SQLite、S3 还是 IndexedDB。底层后端实现 `IStorageBackend` 三层接口即可接入 VFS。中间的挂载系统将路径路由到正确的后端。

---

## 目录结构

```
common/interfaces/fs/
├── index.ts                          # 统一导出
├── constants.ts                      # 常量定义
│
├── core/                             # 核心类型与基础设施
│   ├── types.ts                      # FSNode 判别联合、元数据、能力声明
│   ├── errors.ts                     # POSIX 风格错误体系
│   ├── options.ts                    # 各操作的选项接口
│   └── events.ts                     # 类型化事件系统
│
├── storage/                          # 存储后端规范（面向后端实现者）
│   ├── index.ts                      # 存储层导出
│   ├── backend.ts                    # IStorageBackend 主接口 + 事务
│   ├── inode-store.ts                # Layer 1: 节点结构
│   ├── meta-store.ts                 # Layer 2: 元数据
│   ├── content-store.ts              # Layer 3: 文件内容
│   ├── record-backend.ts            # 可选：SeqFile/Record 原生操作
│   ├── high-level-backend.ts        # 可选：远程后端聚合操作
│   └── syncable-backend.ts          # 可选：同步变更日志
│
├── capabilities/                     # 可选能力子接口（面向模块开发者）
│   ├── seq-file.ts                   # SeqFile 键值操作
│   ├── asset-ops.ts                  # AssetDir 资产管理
│   ├── tag-ops.ts                    # 标签操作
│   ├── ref-ops.ts                    # 双向引用
│   └── watch.ts                      # 文件变更监听
│
├── device/                           # 虚拟设备驱动
│   └── device.ts
│
├── plugin/                           # 插件/中间件系统
│   └── plugin.ts
│
├── mount/                            # 挂载系统
│   └── mount.ts
│
├── sync/                             # 同步系统
│   └── sync.ts
│
└── services/                         # 上层服务接口
    ├── module-fs.ts                  # IModuleFS
    ├── vfs-manager.ts               # IVFSManager
    ├── config-service.ts            # IConfigService
    └── factory.ts                    # VFS 工厂
```

---

## 核心概念

### 文件类型

VFS 支持五种节点类型，通过判别联合实现编译期类型安全：

| 类型 | `type` 值 | 用途 | 专属字段 |
|------|----------|------|---------|
| 普通文件 | `'file'` | 文本/二进制内容 | `size`, `contentHash`, `assetDirId` |
| 目录 | `'directory'` | 组织文件结构 | — |
| SeqFile | `'seqfile'` | 键值对结构数据（配置、SRS 状态等） | `entryCount`, `assetDirId` |
| 设备文件 | `'device'` | 虚拟设备（LLM、定时器等） | `deviceHandlerId` |
| 符号链接 | `'symlink'` | 指向其他节点 | `symlinkTarget` |

```typescript
import type { FSNode } from '@common/interfaces/fs';

function processNode(node: FSNode) {
  switch (node.type) {
    case 'file':
      console.log(`File size: ${node.size}`);       // ✓ 编译器保证
      break;
    case 'device':
      console.log(`Handler: ${node.deviceHandlerId}`); // ✓ 编译器保证
      break;
    case 'symlink':
      console.log(`Target: ${node.symlinkTarget}`);    // ✓ 编译器保证
      break;
  }
}
```

### 目录布局与访问规则

```
/
├── etc/                    全局配置，所有模块可读（非隐藏文件）
├── dev/                    设备文件，所有模块可读（非隐藏文件）
│   ├── null                可见
│   ├── random              可见
│   ├── llm/openai          可见
│   └── .internal           隐藏，仅系统程序可读
└── module/
    ├── notes/              模块 notes 的数据目录
    │   ├── hello.md
    │   ├── _hello.md/      hello.md 的资产目录（自动管理）
    │   └── .state.json     隐藏文件（仅系统程序可读）
    └── tasks/              模块 tasks 的数据目录
```

**访问规则：**

| 路径 | 模块 notes | 模块 tasks | 系统程序 |
|------|-----------|-----------|---------|
| `/module/notes/hello.md` | ✅ 读写 | ❌ | ✅ |
| `/module/tasks/todo.md` | ❌ | ✅ 读写 | ✅ |
| `/etc/config.conf` | ✅ 只读 | ✅ 只读 | ✅ 读写 |
| `/dev/llm/openai` | ✅ 只读 | ✅ 只读 | ✅ 读写 |
| `/dev/.internal` | ❌ | ❌ | ✅ |
| `/module/notes/.state.json` | ❌ | ❌ | ✅ |

模块通过 `IModuleFS` 操作时，看到的是 chroot 隔离的视图：

```
模块 notes 的视图：
  /            → 实际 /module/notes/
  /dev/        → 实际 /dev/ （只读，非隐藏）
  /etc/        → 实际 /etc/ （只读，非隐藏）
```

### AssetDir 资产目录

每个普通文件或 SeqFile 可以拥有一个关联的资产目录，用于存放附件、状态、缓存等。

**命名约定：** 文件 `report.md` 的 assetdir 为同级 `_report.md/`

**生命周期规则：**
- 首次 `putAsset` 时自动创建
- 宿主文件删除时默认级联删除
- 宿主文件重命名时自动跟随重命名
- 宿主文件移动时自动跟随移动

```
/notes/
├── report.md               ← 宿主文件
├── _report.md/             ← 资产目录（自动管理）
│   ├── image1.png          ← 文内引用的图片
│   ├── image2.jpg
│   └── .srs-state.json     ← 插件存储的状态（隐藏）
└── todo.md
```

### 文件命名规则

| 前缀 | 含义 | 用户可创建 | 列目录时显示 |
|------|------|-----------|-------------|
| `.` | 隐藏文件 | ❌ 保留给系统 | 默认不显示 |
| `_` | AssetDir | ❌ 保留给系统 | 默认不显示 |
| 其他 | 普通文件 | ✅ | ✅ |

用户创建文件时，文件名不可以 `.` 或 `_` 开头，否则抛出 `FSReservedNameError`。

### 能力声明

每个 `IModuleFS` 实例声明自己支持的能力，消费方可据此做降级处理：

```typescript
interface FSCapabilities {
  readonly: boolean;        // 是否只读
  search: boolean;          // 全文搜索
  semanticSearch: boolean;  // 语义/向量搜索
  syncable: boolean;        // 同步
  assets: boolean;          // 资产目录
  tags: boolean;            // 标签
  transaction: boolean;     // 事务
  deviceFiles: boolean;     // 设备文件
  seqFiles: boolean;        // SeqFile
  references: boolean;      // 双向引用
  hardlinks: boolean;       // 硬链接
  partialRead: boolean;     // 部分读取
  partialWrite: boolean;    // 部分写入
  treeWalk: boolean;        // 树遍历
  streaming: boolean;       // 流式读取
  watch: boolean;           // 文件监听
  mount: boolean;           // 子挂载
}
```

### 乐观并发控制

每个文件有 `version` 字段，每次内容写入自增。写入时可传入 `expectedVersion` 进行乐观锁检查：

```typescript
// 读取当前版本
const node = await fs.stat('/config.md');
const currentVersion = node.version; // 例如 5

// 写入时带版本检查
await fs.writeContent('/config.md', newContent, {
  expectedVersion: 5, // 期望版本仍为 5
});
// 如果其他写入者已将版本推进到 6，抛出 FSConflictError
```

---

## 上层应用开发指南

### 获取模块文件系统

```typescript
import type { IModuleFS, IVFSManager } from '@common/interfaces/fs';

// 通过 VFS Manager 获取模块隔离视图
const notesFS: IModuleFS = vfsManager.getEngine('notes');

// 模块看到的根目录 "/" 实际对应 /module/notes/
// 所有路径操作都在模块沙箱内
```

### 基础文件操作

```typescript
// 创建文件
const file = await fs.createFile({
  name: 'hello.md',
  parentIdOrPath: '/',
  content: '# Hello World',
  tags: ['greeting'],
});

// 读取
const content = await fs.readContent('/hello.md');

// 写入（覆盖）
await fs.writeContent('/hello.md', '# Updated Content', {
  expectedVersion: file.version,
});

// 追加
await fs.appendContent('/hello.md', '\n## New Section');

// 创建目录
await fs.createDirectory({ name: 'notes', parentIdOrPath: '/' });

// 列目录（默认隐藏 . 和 _ 开头的文件）
const children = await fs.getChildren('/notes');

// 移动
await fs.move(['/hello.md'], '/notes');

// 重命名
await fs.rename('/notes/hello.md', 'greeting.md');

// 删除（级联删除 assetdir）
await fs.delete(['/notes/greeting.md']);

// 检查存在
const exists = await fs.exists('/notes/greeting.md');

// 获取详情
const node = await fs.getNode('/notes');
```

### SeqFile 操作

```typescript
// 需要 capabilities.seqFiles === true
if (fs.seq) {
  // 创建 SeqFile
  await fs.createFile({
    name: 'settings.conf',
    parentIdOrPath: '/',
    type: 'seqfile',
  });

  // 键值操作
  await fs.seq.setEntry('/settings.conf', 'theme', 'dark');
  await fs.seq.setEntry('/settings.conf', 'language', 'zh-CN');

  const theme = await fs.seq.getEntry('/settings.conf', 'theme');
  // → 'dark'

  const all = await fs.seq.getAllEntries('/settings.conf');
  // → [{ key: 'theme', value: 'dark' }, { key: 'language', value: 'zh-CN' }]

  // 批量设置
  await fs.seq.setEntries('/settings.conf', {
    fontSize: '14',
    fontFamily: 'monospace',
  });
}
```

### 资产目录操作

```typescript
// 需要 capabilities.assets === true
if (fs.assets) {
  // 写入资产（assetdir 自动创建）
  await fs.assets.putAsset('/report.md', 'chart.png', imageData);

  // 读取资产
  const png = await fs.assets.getAsset('/report.md', 'chart.png');

  // 列出资产
  const assets = await fs.assets.listAssets('/report.md');
  // → ['chart.png', 'data.csv']

  // 删除资产
  await fs.assets.deleteAsset('/report.md', 'data.csv');
}
```

### 标签操作

```typescript
// 需要 capabilities.tags === true
if (fs.tags) {
  await fs.tags.setTags('/hello.md', ['important', 'draft']);
  await fs.tags.addTag('/hello.md', 'reviewed');
  await fs.tags.removeTag('/hello.md', 'draft');

  const ids = await fs.tags.findByTag('important');
}
```

### 双向引用

```typescript
// 需要 capabilities.references === true
if (fs.refs) {
  // 添加引用：hello.md 提及了 report.md
  await fs.refs.addRef('/hello.md', '/report.md', 'mention');

  // 查询正向引用：hello.md 引用了谁？
  const outgoing = await fs.refs.getOutgoing('/hello.md');

  // 查询反向引用：report.md 被谁引用了？
  const incoming = await fs.refs.getIncoming('/report.md');

  // 全量同步（内容解析后批量替换）
  await fs.refs.syncOutgoing('/hello.md', [
    { targetIdOrPath: '/report.md', refType: 'mention' },
    { targetIdOrPath: '/data.csv', refType: 'embed' },
  ]);
}
```

### 设备文件

```typescript
// 通过模块视图访问 /dev/
const content = await fs.readContent('/dev/random');

// 设备控制命令
await fs.ioctl?.('/dev/llm/openai', 'set-model', { model: 'gpt-4' });

// 写入设备（如 LLM prompt）
await fs.writeContent('/dev/llm/openai', 'Summarize this document');
const response = await fs.readContent('/dev/llm/openai');
```

### 事务

```typescript
// 需要 capabilities.transaction === true
await fs.transaction?.(async (tx) => {
  const f1 = await tx.createFile({ name: 'a.md', parentIdOrPath: '/' });
  const f2 = await tx.createFile({ name: 'b.md', parentIdOrPath: '/' });
  await tx.updateMetadata(f1.id, { ai_defaultAgent: 'gpt-4' });
  // 任一操作失败 → 全部回滚，不触发事件
});
// commit 后合并触发事件
```

### 事件监听

```typescript
// 监听模块内所有事件
const unsub = fs.on('node:updated', (event) => {
  console.log(`Updated: ${event.payload.nodes[0].path}`);
});

// 清理
unsub();
```

### 搜索

```typescript
const results = await fs.search({
  text: 'meeting notes',
  type: 'file',
  tags: ['important'],
  limit: 20,
});
```

### 链接

```typescript
// 符号链接
await fs.symlink('/shortcut.md', '/deep/nested/original.md');
const target = await fs.readlink('/shortcut.md');
// → '/deep/nested/original.md'

// 硬链接（需要 capabilities.hardlinks）
await fs.hardlink?.('/alias.md', '/original.md');
```

### 能力检查

```typescript
function setupModule(fs: IModuleFS) {
  // 始终可用的核心操作
  fs.getNode('/');
  fs.getChildren('/');
  fs.readContent('/file.md');

  // 按能力降级
  if (fs.capabilities.tags && fs.tags) {
    fs.tags.setTags('/file.md', ['tag1']);
  }

  if (fs.capabilities.transaction) {
    fs.transaction?.(async (tx) => { /* ... */ });
  } else {
    // 降级为逐个操作
  }
}
```

---

## 底层存储开发指南

### 最小实现：IStorageBackend

要接入 VFS，存储后端只需实现 `IStorageBackend` 接口：

    import type { IStorageBackend } from '@itookit/vfs-core';

    class MyBackend implements IStorageBackend {
      readonly name = 'my-backend';

      async stat(path) { /* → FSNode | null */ }
      async list(path) { /* → FSNode[] */ }
      async mkdir(path) { /* → FSNode */ }
      async delete(path, opts) { /* opts.recursive */ }
      async rename(from, to) {}

      async read(path, opts) { /* opts.offset/opts.length → Uint8Array */ }
      async write(path, content) { /* Uint8Array → FSNode */ }

      async updateMetadata(path, metadata) {}
      async setTags(path, tags) {}
      async getAllTags() { /* → string[] */ }

      // 可选能力（不支持则不定义）
      records?: IRecordStore;
      search?(query): Promise<FSNode[]>;
      symlink?(linkPath, target): Promise<void>;
      readlink?(path): Promise<string>;
      transaction?<T>(fn: (tx: IStorageBackend) => Promise<T>): Promise<T>;

      async init() {}
      async close() {}
    }

### 存储模型

v4.1 起为单一 path-based 接口：节点结构、内容、元数据、标签由后端内部统一存储（单一 object store 或表）。不再拆分 IInodeStore / IMetaStore / IContentStore 三层，亦无 runInTransaction / descriptor.features。

### 事务支持

事务为闭包式 **transaction?<T>(fn: (tx: IStorageBackend) => Promise<T>)**。真正的隔离由后端自行实现；**MemoryBackend** / **IndexedDBBackend** 均为透传（fn(this)），文件级原子性不保证；SeqFile 记录级原子性由 **IRecordStore.transaction** 提供。

### 可选增强：IRecordStore

DB 后端实现此接口可利用索引加速 SeqFile 字段级查询：

```typescript
interface IRecordStore {
  getField(ino: number, field: string): Promise<RecordValue | undefined>;
  setField(ino: number, field: string, value: RecordValue): Promise<void>;
  // ...
}
```

未实现时 VFS Engine 退化为整体 JSON 序列化。

### 可选增强：IHighLevelStore

远程后端实现此接口减少网络往返：

```typescript
interface IHighLevelStore {
  readByPath?(path: string): Promise<{ inode: StorageInode; data: ArrayBuffer } | null>;
  writeByPath?(path: string, data: ArrayBuffer, metadata?: Record<string, unknown>): Promise<StorageInode>;
  listByPath?(path: string): Promise<Array<{ name: string; inode: StorageInode }>>;
}
```

### 可选增强：ISyncableStore

后端实现此接口提供高效的变更日志：

```typescript
interface ISyncableStore {
  getChangesSince(seq: number, limit?: number): Promise<SyncChangeEntry[]>;
  getLatestSeq(): Promise<number>;
  getSyncAdapter?(): ISyncAdapter;
}
```

### 后端实现清单

| 后端 | 事务 | RecordStore | HighLevel | Syncable | 备注 |
|------|------|------------|-----------|----------|------|
| SQLite | ✅ | ✅ | — | ✅ (WAL) | 推荐的桌面后端 |
| IndexedDB | ✅ | ✅ | — | — | 浏览器后端 |
| PostgreSQL | ✅ | ✅ | — | ✅ (trigger) | 服务器后端 |
| S3 | — | — | ✅ | ✅ (Event) | 远程归档 |
| Memory | ✅ | ✅ | — | — | 测试用 |
| 本地文件系统 | — | — | ✅ | ✅ (inotify) | Electron 可选 |

---

## 挂载系统

### 基本用法

```typescript
// 根 "/" 在工厂创建时绑定，不可卸载
const vfs = await createVFS({
  rootBackend: new IndexedDBBackend({ dbName: 'app' }),
});

// 运行时挂载额外后端
await vfs.manager.mountBackend('/module/archive', new S3Backend({
  bucket: 'my-archive',
}), {
  label: 'S3 Archive',
  syncable: true,
  syncConfig: {
    direction: 'bidirectional',
    strategy: 'batch',
    batchIntervalMs: 30000,
    conflictResolution: 'newest-wins',
  },
});

// 此后 /module/archive/** 的操作路由到 S3Backend
// 模块 'archive' 的 IModuleFS 操作完全透明
```

### 路径解析规则

最长前缀匹配：

```
挂载表：
  /                   → IndexedDB
  /module/archive     → S3

resolve('/module/archive/report.md')
  → { mount: S3, relativePath: '/report.md' }

resolve('/module/notes/todo.md')
  → { mount: IndexedDB, relativePath: '/module/notes/todo.md' }

resolve('/etc/config')
  → { mount: IndexedDB, relativePath: '/etc/config' }
```

### 跨挂载点操作

当 `move` / `copy` 跨越挂载点边界时：

1. **同挂载点**：后端内原子 rename/copy
2. **跨挂载点**：降级为 copy + delete（非原子，best-effort + 补偿）

```typescript
// 同挂载点 — 原子操作
await fs.move(['/notes/a.md'], '/notes/sub/');

// 跨挂载点 — copy + delete
await fs.move(['/local/a.md'], '/archive/');
// 内部流程：
// 1. 从 IndexedDB 读取 a.md 内容 + 元数据 + assetdir
// 2. 在 S3 创建新文件
// 3. 从 IndexedDB 删除原文件
// 4. 如果步骤 3 失败，记录到 orphan 日志
```

---

## 同步系统

### 同步架构

```
VFS Engine ──── FSEvent ────► SyncService ──── ISyncAdapter ────► 远端
                                │
                          changelog[]
                                │
                          conflict queue
```

SyncService 是 VFS 的消费者（非内核），通过监听文件变更事件构建 changelog，按策略推送/拉取变更。

### 配置同步目标

在挂载时通过`syncConfig` 指定：

```typescript
await vfs.manager.mountBackend('/module/notes', sqliteBackend, {
  syncable: true,
  syncConfig: {
    direction: 'bidirectional',
    strategy: 'batch',           // 'immediate' | 'batch' | 'manual'
    batchIntervalMs: 30_000,
    conflictResolution: 'newest-wins',
    remoteId: 'server-xyz',
  },
});

// 手动触发同步
const sync = vfs.manager.getSyncService();
if (sync) {
  const results = await sync.sync();
  // [{ mountId: 'mount-xxx', pushed: 5, pulled: 3, conflicts: 0 }]
}
```

### 冲突解决

```typescript
const sync = vfs.manager.getSyncService()!;

// 查看冲突
const conflicts = await sync.getConflicts();

// 逐个解决
await sync.resolveConflict(conflicts[0].id, { strategy: 'keep-local' });

// 批量解决
await sync.resolveAllConflicts('mount-xxx', { strategy: 'keep-remote' });

// 监听冲突
sync.onConflict((conflict) => {
  console.warn(`Conflict on ${conflict.path}`);
});
```

---

## 插件开发指南

插件采用 Koa 风格中间件管道，支持前后拦截和短路：

```typescript
import type { IPlugin, OperationContext, MiddlewareNext } from '@common/interfaces/fs';

const autoVersionPlugin: IPlugin = {
  info: { id: 'auto-version', name: 'Auto Version' },
  priority: 50,
  operations: ['write'],

  async middleware(ctx: OperationContext, next: MiddlewareNext) {
    // ── before: 写入前快照当前内容到 assetdir ──
    const oldContent = ctx.args.currentContent;
    if (oldContent) {
      const timestamp = Date.now();
      // 通过 pluginData 传递给 assetdir
      ctx.pluginData.set('auto-version', { snapshot: oldContent, ts: timestamp });
    }

    await next(); // 执行实际写入

    // ── after: 写入成功后保存版本 ──
    const snapshot = ctx.pluginData.get('auto-version');
    if (snapshot) {
      // 保存到 assetdir/.versions/
    }
  },

  async init() { console.log('AutoVersion plugin loaded'); },
  async dispose() { console.log('AutoVersion plugin unloaded'); },
};
```

注册：

```typescript
await vfs.manager.registerPlugin(autoVersionPlugin);
```

---

## 设备驱动开发指南

```typescript
import type { IDeviceDriver, DeviceContext } from '@common/interfaces/fs';

const randomDevice: IDeviceDriver = {
  handlerId: 'random',
  description: 'Random byte generator',
  writable: false,
  sessionable: false,

  async read(ctx: DeviceContext) {
    const buf = new Uint8Array(256);
    crypto.getRandomValues(buf);
    return buf.buffer;
  },

  async write() {
    throw new Error('Device is read-only');
  },
};

// LLM 设备（有状态，支持会话和流式读取）
const llmDevice: IDeviceDriver = {
  handlerId: 'llm-openai',
  description: 'OpenAI LLM',
  writable: true,
  sessionable: true,
  streamable: true,

  async open(ctx, options) {
    // 创建会话，返回 sessionId
    return crypto.randomUUID();
  },

  async write(ctx, content) {
    // 将 content 作为 user message 加入会话
  },

  async read(ctx) {
    // 返回完整响应
    return 'AI response';
  },

  async *readStream(ctx) {
    // 流式返回
    yield 'Hello';
    yield ' World';
  },

  async close(ctx) {
    // 清理会话资源
  },
};
```

---

## 系统管理

### IVFSManager

系统级入口，面向框架和管理程序：

```typescript
// 模块管理
await vfs.mount('notes', { description: 'User Notes' });
const engine = vfs.getEngine('notes');

// 跨模块便捷操作
await vfs.write('notes', '/hello.md', '# Hello');
const content = await vfs.read('notes', '/hello.md');
const exists = await vfs.exists('notes', '/hello.md');

// 系统级路径操作（绕过 chroot）
const node = await vfs.systemStat('/module/notes/hello.md');

// 全局搜索
const results = await vfs.search({ text: 'meeting', modules: ['notes', 'tasks'] });
```

### 配置服务

```typescript
const config = vfsInstance.config;

await config.set('app', 'theme', 'dark');
const theme = await config.getString('app', 'theme', 'light');

config.onChange('app', (event) => {
  console.log(`${event.key}: ${event.oldValue} → ${event.newValue}`);
});
```

### 维护操作

```typescript
// 垃圾回收
const gcResult = await vfs.gc?.();
// { cleaned: 12, freedBytes: 1048576 }

// 完整性检查
const fsckResult = await vfs.fsck?.();
// { ok: false, errors: [{ path: '/orphan.md', issue: 'missing content', severity: 'error' }] }

// 导出/导入
const data = await vfs.exportModule('notes');
await vfs.importModule(data);
```

---

## 工厂与初始化

```typescript
import { createVFS } from '@app/vfs';

const vfsInstance = await createVFS({
  rootBackend: new SQLiteBackend({ path: './data.db' }),
  modules: [{ name: 'notes' }, { name: 'tasks' }],
  devices: [randomDevice, llmDevice],
  plugins: [autoVersionPlugin],
  additionalMounts: [
    {
      mountPath: '/module/archive',
      backend: new S3Backend({ bucket: 'archive' }),
      options: { syncable: true, label: 'S3 Archive' },
    },
  ],
});

const { manager, config } = vfsInstance;
```

---

## 错误处理

所有 VFS 操作抛出 `FSError` 或其子类：

```typescript
import { FSError, FSNotFoundError, FSConflictError } from '@common/interfaces/fs';

try {
  await fs.readContent('/missing.md');
} catch (e) {
  if (e instanceof FSNotFoundError) {
    console.log('File not found');
  } else if (e instanceof FSConflictError) {
    console.log(`Version conflict: expected ${e.expectedVersion}, got ${e.actualVersion}`);
  } else if (e instanceof FSError) {
    console.log(`VFS error [${e.code}]: ${e.message}`);
  }
}
```

| 错误码 | 子类 | 含义 |
|--------|------|------|
| `ENOENT` | `FSNotFoundError` | 文件/目录不存在 |
| `EEXIST` | `FSAlreadyExistsError` | 已存在 |
| `EACCES` | `FSAccessDeniedError` | 权限拒绝 |
| `EROFS` | `FSReadOnlyError` | 只读文件系统 |
| `ECONFLICT` | `FSConflictError` | 乐观锁版本冲突 |
| `ERESERVED` | `FSReservedNameError` | 保留文件名 |
| `ELOOP` | `FSSymlinkLoopError` | 符号链接循环 |
| `ECAPABILITY` | `FSCapabilityError` | 能力不支持 |
| `ENOMODULE` | `FSModuleNotFoundError` | 模块未挂载 |
| `EXMOUNT` | `FSCrossMountError` | 跨挂载操作被拒绝 |

---

## 设计决策

| 决策 | 理由 |
|------|------|
| **存储三层分离（内部）+ FSNode 扁平（外部）** | 后端实现灵活度最大 × 上层使用简单 |
| **FSNode 判别联合** | 编译期类型安全，设备/链接的专属字段不污染其他类型 |
| **capabilities 布尔结构体** | IDE 补全友好，新能力只加字段（OCP） |
| **IModuleFS chroot 隔离** | 模块只看到自己的文件 + 公共资源（LoD） |
| **事务闭包 API** | 保证 commit/rollback 自动执行，避免泄漏 |
| **Plugin 中间件管道** | 支持前后拦截和短路，比纯 before/after 更灵活 |
| **AssetDir `_` 前缀** | 与隐藏文件 `.` 前缀分离，避免语义冲突 |
| **引用存储在 root backend** | 引用是全局关系，不分散到各后端 |
| **跨挂载 move = copy + delete** | 无法跨后端原子 rename，明确语义 |
| **SyncService 异步不阻塞** | 写入延迟不受远端网络影响 |
| **root backend 不可卸载** | 始终有可靠本地存储兜底 |
| **POSIX 错误码 + 类型化子类** | POSIX 直觉友好 + instanceof 编程友好 |
| **渐进增强后端接口** | 简单后端只实现基础接口，DB 后端可选增强 |
```

---

以下是全部接口代码文件：

---

```typescript
/**
 * @file common/interfaces/fs/constants.ts
 * @desc VFS 常量定义
 */

/** 配置模块名称（始终自动挂载） */
export const CONFIG_MODULE = '__config';

/** 保留目录 */
export const SYSTEM_DIRS = ['etc', 'dev', 'module'] as const;

/** 挂载信息存储路径 */
export const MOUNT_REGISTRY_PATH = '/etc/.mounts';

/** 孤儿记录日志路径 */
export const ORPHAN_LOG_PATH = '/etc/.orphans';

/** 隐藏文件前缀 */
export const HIDDEN_PREFIX = '.';

/** AssetDir 前缀 */
export const ASSET_DIR_PREFIX = '_';

/** 默认 symlink 解析最大深度 */
export const DEFAULT_MAX_SYMLINK_DEPTH = 40;

/** 默认文件名验证正则 */
export const DEFAULT_FILENAME_PATTERN = /^[^._/\\][^/\\]*$/;
```

---

```typescript
/**
 * @file common/interfaces/fs/core/types.ts
 * @desc 基础类型定义 — FSNode 判别联合、元数据、能力声明、搜索、统计
 *
 * 设计原则：
 * - FSNode 使用判别联合，编译器通过 type 字段自动收窄
 * - 能力声明使用 boolean 结构，IDE 补全友好
 * - 时间统一使用 number (ms epoch)，跨平台序列化友好
 * - 元数据为 AI 字段提供类型提示，同时保持自由扩展
 */

// ═══════════════════════════════════════════════════════════════
// 节点类型
// ═══════════════════════════════════════════════════════════════

export type FSNodeBaseType = 'file' | 'directory';
export type FSNodeExtendedType = 'seqfile' | 'device' | 'symlink';
export type FSNodeType = FSNodeBaseType | FSNodeExtendedType;

// ═══════════════════════════════════════════════════════════════
// 元数据
// ═══════════════════════════════════════════════════════════════

/**
 * 节点元数据
 *
 * 继承 Record 保持自由扩展，同时为已知字段提供类型提示。
 * 插件可往 metadata 中写入自定义字段。
 */
export interface FSNodeMetadata extends Record<string, unknown> {
  /** AI Agent ID */
  ai_defaultAgent?: string;
  /** System prompt */
  ai_systemPrompt?: string;
  /** Initial prompt */
  ai_initialPrompt?: string;
  /** 向量嵌入状态 */
  ai_embeddingStatus?: 'pending' | 'processing' | 'done' | 'error';
}

// ═══════════════════════════════════════════════════════════════
// FSNode 判别联合
// ═══════════════════════════════════════════════════════════════

interface FSNodeBase {
  /** 节点唯一标识符 */
  readonly id: string;
  /** 父节点 ID，根节点为 null */
  readonly parentId: string | null;
  /** 节点名称（含扩展名） */
  readonly name: string;
  /** 创建时间戳 (ms) */
  readonly createdAt: number;
  /** 内容最后修改时间戳 (ms) */
  modifiedAt: number;
  /** 模块内逻辑路径 */
  readonly path: string;
  /** 版本号，每次内容写入自增（乐观锁） */
  version: number;
  /** 硬链接计数 */
  readonly nlink: number;
  /** 标签列表 */
  tags?: string[];
  /** 自由格式元数据 */
  metadata?: FSNodeMetadata;
  /** 所属模块 ID（跨模块结果中标识来源） */
  moduleId?: string;
  /** 自定义图标 (Emoji 或 URL) */
  icon?: string;
  /** MIME 类型 */
  mimeType?: string;
}

export interface FSFileNode extends FSNodeBase {
  readonly type: 'file';
  /** 文件大小（字节） */
  size: number;
  /** 内容哈希（可选，由插件填充） */
  contentHash?: string;
  /** 关联的资产目录 ID */
  assetDirId?: string;
}

export interface FSDirectoryNode extends FSNodeBase {
  readonly type: 'directory';
}

export interface FSSeqFileNode extends FSNodeBase {
  readonly type: 'seqfile';
  /** 条目数量 */
  entryCount?: number;
  /** 关联的资产目录 ID */
  assetDirId?: string;
}

export interface FSDeviceNode extends FSNodeBase {
  readonly type: 'device';
  /** 设备处理器 ID（必填） */
  readonly deviceHandlerId: string;
}

export interface FSSymlinkNode extends FSNodeBase {
  readonly type: 'symlink';
  /** 链接目标路径（必填） */
  readonly symlinkTarget: string;
}

/**
 * 完整节点类型（判别联合）
 *
 * 编译器通过 type 字段自动收窄：
 * ```ts
 * if (node.type === 'device') {
 *   node.deviceHandlerId; // ✓ string
 * }
 * if (node.type === 'file') {
 *   node.size; // ✓ number
 * }
 * ```
 */
export type FSNode =
  | FSFileNode
  | FSDirectoryNode
  | FSSeqFileNode
  | FSDeviceNode
  | FSSymlinkNode;

// ═══════════════════════════════════════════════════════════════
// SeqFile 条目
// ═══════════════════════════════════════════════════════════════

export interface SeqFileEntry {
  key: string;
  value: string;
  valueType?: 'string' | 'number' | 'boolean' | 'json';
}

// ═══════════════════════════════════════════════════════════════
// 目录条目（轻量，列目录时返回）
// ═══════════════════════════════════════════════════════════════

export interface DirEntry {
  readonly name: string;
  readonly id: string;
  readonly type: FSNodeType;
}

// ═══════════════════════════════════════════════════════════════
// 文件内容类型
// ═══════════════════════════════════════════════════════════════

export type FileContent = string | ArrayBuffer | Uint8Array;

// ═══════════════════════════════════════════════════════════════
// 搜索
// ═══════════════════════════════════════════════════════════════

export interface FSSearchQuery {
  /** 全文关键词 */
  text?: string;
  /** 节点类型过滤 */
  type?: FSNodeType | FSNodeType[];
  /** 标签过滤（AND 语义） */
  tags?: string[];
  /** 元数据字段过滤 */
  metadata?: Record<string, unknown>;
  /** 最大返回数量 @default 50 */
  limit?: number;
  /** 偏移 @default 0 */
  offset?: number;
  /** 向量近邻搜索（需要 capabilities.semanticSearch） */
  vector?: number[];
  /** 语义搜索文本（实现自动转向量） */
  semanticText?: string;
  /** 最低相似度阈值 (0-1) */
  minScore?: number;
}

// ═══════════════════════════════════════════════════════════════
// 能力声明
// ═══════════════════════════════════════════════════════════════

/**
 * 布尔结构，IDE 补全友好。
 * 新增能力只需添加字段，已有实现默认 false（OCP）。
 */
export interface FSCapabilities {
  /** 是否只读 */
  readonly: boolean;
  /** 是否支持全文搜索 */
  search: boolean;
  /** 是否支持语义/向量搜索 */
  semanticSearch: boolean;
  /** 是否支持同步 */
  syncable: boolean;
  /** 是否支持资产目录 */
  assets: boolean;
  /** 是否支持标签 */
  tags: boolean;
  /** 是否支持事务 */
  transaction: boolean;
  /** 是否支持设备文件 */
  deviceFiles: boolean;
  /** 是否支持 seqfile */
  seqFiles: boolean;
  /** 是否支持双向引用 */
  references: boolean;
  /** 是否支持硬链接 */
  hardlinks: boolean;
  /** 是否支持部分读取 */
  partialRead: boolean;
  /** 是否支持部分写入 */
  partialWrite: boolean;
  /** 是否支持树遍历 */
  treeWalk: boolean;
  /** 是否支持设备流式读取 */
  streaming: boolean;
  /** 是否支持 watch */
  watch: boolean;
  /** 是否支持挂载子后端 */
  mount: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 统计
// ═══════════════════════════════════════════════════════════════

export interface FSModuleStats {
  fileCount: number;
  directoryCount: number;
  totalSize: number;
  lastModifiedAt: number;
  typeBreakdown?: Partial<Record<FSNodeType, number>>;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/core/errors.ts
 * @desc POSIX 风格错误体系
 *
 * 设计：
 * - 基类 FSError 携带 code / operation / path（结构化错误信息）
 * - 常见错误有具名子类（消费方可 instanceof 判断）
 * - code 使用 POSIX 风格字符串（跨平台友好，可 grep 日志）
 */

export type FSErrorCode =
  | 'ENOENT'
  | 'EEXIST'
  | 'EISDIR'
  | 'ENOTDIR'
  | 'ENOTEMPTY'
  | 'EACCES'
  | 'EROFS'
  | 'ENOSPC'
  | 'ENOTTY'
  | 'EINVAL'
  | 'ELOOP'
  | 'EIO'
  | 'EPLUGIN'
  | 'ENOTRECORD'
  | 'ENOMODULE'
  | 'ECAPABILITY'
  | 'ECONFLICT'
  | 'EBUSY'
  | 'EXMOUNT'
  | 'ERESERVED'
  | 'EINTERNAL';

export class FSError extends Error {
  constructor(
    public readonly code: FSErrorCode,
    message: string,
    public readonly operation?: string,
    public readonly path?: string,
    public readonly cause?: Error,
  ) {
    super(
      path
        ? `[${code}] ${operation ?? 'fs'} "${path}": ${message}`
        : `[${code}] ${operation ?? 'fs'}: ${message}`,
    );
    this.name = 'FSError';
  }
}

export class FSNotFoundError extends FSError {
  constructor(idOrPath: string, operation?: string) {
    super('ENOENT', `not found: ${idOrPath}`, operation, idOrPath);
    this.name = 'FSNotFoundError';
  }
}

export class FSAlreadyExistsError extends FSError {
  constructor(path: string, operation?: string) {
    super('EEXIST', `already exists: ${path}`, operation, path);
    this.name = 'FSAlreadyExistsError';
  }
}

export class FSAccessDeniedError extends FSError {
  constructor(path: string, operation?: string, detail?: string) {
    super('EACCES', detail ?? `permission denied`, operation, path);
    this.name = 'FSAccessDeniedError';
  }
}

export class FSReadOnlyError extends FSError {
  constructor(path?: string, operation?: string) {
    super('EROFS', 'read-only filesystem', operation, path);
    this.name = 'FSReadOnlyError';
  }
}

export class FSReservedNameError extends FSError {
  constructor(name: string) {
    super('ERESERVED', `filename must not start with . or _: "${name}"`, 'create', name);
    this.name = 'FSReservedNameError';
  }
}

export class FSConflictError extends FSError {
  constructor(
    idOrPath: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(
      'ECONFLICT',
      `version conflict: expected ${expectedVersion}, actual ${actualVersion}`,
      'write',
      idOrPath,
    );
    this.name = 'FSConflictError';
  }
}

export class FSCapabilityError extends FSError {
  constructor(capability: string, moduleId?: string) {
    super(
      'ECAPABILITY',
      `capability '${capability}' not supported${moduleId ? ` by module '${moduleId}'` : ''}`,
    );
    this.name = 'FSCapabilityError';
  }
}

export class FSModuleNotFoundError extends FSError {
  constructor(moduleName: string) {
    super('ENOMODULE', `module '${moduleName}' is not mounted`);
    this.name = 'FSModuleNotFoundError';
  }
}

export class FSSymlinkLoopError extends FSError {
  constructor(path: string) {
    super('ELOOP', 'too many levels of symbolic links', 'resolve', path);
    this.name = 'FSSymlinkLoopError';
  }
}

export class FSCrossMountError extends FSError {
  constructor(srcPath: string, destPath: string) {
    super('EXMOUNT', `cross-mount operation denied: ${srcPath} → ${destPath}`, 'move', srcPath);
    this.name = 'FSCrossMountError';
  }
}

export class FSInvalidPathError extends FSError {
  constructor(path: string, reason?: string) {
    super('EINVAL', `invalid path '${path}'${reason ? ': ' + reason : ''}`, undefined, path);
    this.name = 'FSInvalidPathError';
  }
}
```

---

```typescript
/**
 * @file common/interfaces/fs/core/options.ts
 * @desc 各操作的选项接口
 *
 * 每个操作使用独立选项类型（ISP），
 * 默认值由实现方定义，通过 JSDoc @default 标注。
 */

import type { FSNodeType, FSNodeMetadata } from './types';

// ═══════════════════════════════════════════════════════════════
// 读取
// ═══════════════════════════════════════════════════════════════

export interface ReadOptions {
  /** 起始偏移（需要 capabilities.partialRead） */
  offset?: number;
  /** 读取长度（需要 capabilities.partialRead） */
  length?: number;
  /**
   * 编码提示
   * - 'utf-8': 返回 string
   * - 'binary': 返回 ArrayBuffer
   * - 'auto': 由实现根据 mimeType/扩展名决定
   * @default 'auto'
   */
  encoding?: 'utf-8' | 'binary' | 'auto';
  /** 设备会话 ID（仅设备文件有效） */
  deviceSessionId?: string;
}

// ═══════════════════════════════════════════════════════════════
// 写入
// ═══════════════════════════════════════════════════════════════

export interface WriteOptions {
  /** 起始偏移（需要 capabilities.partialWrite） */
  offset?: number;
  /**
   * 写入模式
   * @default 'overwrite'
   */
  mode?: 'overwrite' | 'append';
  /**
   * 乐观锁：期望的版本号
   * 不匹配时抛出 FSConflictError。不传则不检查。
   */
  expectedVersion?: number;
  /** 设备会话 ID（仅设备文件有效） */
  deviceSessionId?: string;
  /** 同时更新元数据 */
  metadata?: Partial<FSNodeMetadata>;
}

// ═══════════════════════════════════════════════════════════════
// 创建
// ═══════════════════════════════════════════════════════════════

export interface CreateFileOptions {
  name: string;
  parentIdOrPath: string | null;
  content?: string | ArrayBuffer;
  metadata?: FSNodeMetadata;
  tags?: string[];
  icon?: string;
  /** @default 'file' */
  type?: FSNodeType;
  /**
   * 是否递归创建中间目录
   * @default false
   */
  recursive?: boolean;
  /**
   * 已存在时是否覆盖
   * @default false
   */
  overwrite?: boolean;
}

export interface CreateDirectoryOptions {
  name: string;
  parentIdOrPath: string | null;
  metadata?: FSNodeMetadata;
  icon?: string;
  /**
   * 是否递归创建中间目录
   * @default false
   */
  recursive?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 删除
// ═══════════════════════════════════════════════════════════════

export interface DeleteOptions {
  /**
   * AssetDir 处理策略
   * - 'remove': 同时删除 assetdir 及其全部内容
   * - 'orphan': 保留目录但降级为普通目录
   * - 'keep':   完全不处理 assetdir
   * @default 'remove'
   */
  assetDirStrategy?: 'remove' | 'orphan' | 'keep';
  /**
   * 删除目录时是否递归
   * @default false
   */
  recursive?: boolean;
  /**
   * 是否强制删除（忽略不存在等错误）
   * @default false
   */
  force?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 重命名 / 移动
// ═══════════════════════════════════════════════════════════════

export interface RenameOptions {
  /**
   * 是否同步重命名 assetdir
   * @default true
   */
  syncAssetDir?: boolean;
}

export interface MoveOptions {
  /**
   * 是否同步移动 assetdir
   * @default true
   */
  syncAssetDir?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 复制
// ═══════════════════════════════════════════════════════════════

export interface CopyOptions {
  /**
   * 已存在时是否覆盖
   * @default false
   */
  overwrite?: boolean;
  /**
   * 是否同时复制 assetdir
   * @default true
   */
  copyAssetDir?: boolean;
  /**
   * 是否递归创建中间目录
   * @default false
   */
  recursive?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 列目录
// ═══════════════════════════════════════════════════════════════

export interface ListOptions {
  /**
   * 包含隐藏文件（. 开头）
   * @default false
   */
  includeHidden?: boolean;
  /**
   * 包含 assetdir（_ 开头）
   * @default false
   */
  includeAssetDirs?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 树遍历
// ═══════════════════════════════════════════════════════════════

export interface TreeWalkOptions {
  /**
   * 遍历顺序
   * @default 'depth-first'
   */
  order?: 'breadth-first' | 'depth-first';
  /**
   * 最大深度，-1 无限制
   * @default -1
   */
  maxDepth?: number;
  /** 起始目录 @default 模块根目录 */
  rootIdOrPath?: string;
  /** 类型过滤 */
  typeFilter?: FSNodeType | FSNodeType[];
  /** 最大返回数量 */
  limit?: number;
  /**
   * 包含隐藏文件
   * @default false
   */
  includeHidden?: boolean;
}

/**
 * 树遍历回调
 * @returns true/void 继续 | false 停止 | 'skip' 跳过子树
 */
export type TreeWalkCallback = (
  node: import('./types').FSNode,
  depth: number,
) => boolean | void | 'skip' | Promise<boolean | void | 'skip'>;

// ═══════════════════════════════════════════════════════════════
// Watch
// ═══════════════════════════════════════════════════════════════

export interface WatchOptions {
  /**
   * 是否递归监听子目录
   * @default false
   */
  recursive?: boolean;
  /**
   * 防抖间隔 (ms)
   * @default 100
   */
  debounceMs?: number;
  /** 忽略的文件名模式 */
  ignorePatterns?: string[];
}
```

---

```typescript
/**
 * @file common/interfaces/fs/core/events.ts
 * @desc 类型化事件系统
 *
 * 设计：
 * - 类型映射保证 on<E> 签名编译期安全
 * - payload 统一使用数组形式 — 单操作 length===1，批量 length>1
 * - 事务合并策略：事务内不逐个触发，commit 后合并同类型事件
 * - 每个事件携带 fromTransaction 标记，消费方可区分
 */

import type { FSNodeType } from './types';

// ═══════════════════════════════════════════════════════════════
// 事件类型
// ═══════════════════════════════════════════════════════════════

export type FSEventType =
  | 'node:created'
  | 'node:updated'
  | 'node:deleted'
  | 'node:moved'
  | 'node:copied'
  | 'node:renamed'
  | 'mount:added'
  | 'mount:removed'
  | 'error';

// ═══════════════════════════════════════════════════════════════
// 事件载荷
// ═══════════════════════════════════════════════════════════════

export interface FSNodeCreatedPayload {
  nodes: Array<{
    nodeId: string;
    parentId: string | null;
    path: string;
    type: FSNodeType;
  }>;
}

export interface FSNodeUpdatedPayload {
  nodes: Array<{
    nodeId: string;
    path: string;
    changedFields?: Array<'content' | 'metadata' | 'tags'>;
  }>;
  reason?: 'content' | 'metadata' | 'tags' | 'mixed';
}

export interface FSNodeDeletedPayload {
  /** 用户显式请求删除的 ID */
  requestedIds: string[];
  /** 含级联删除的所有 ID（包含 assetdir 内文件） */
  allDeletedIds: string[];
}

export interface FSNodeMovedPayload {
  nodes: Array<{
    nodeId: string;
    oldPath: string;
    newPath: string;
    oldParentId: string | null;
    newParentId: string | null;
  }>;
}

export interface FSNodeCopiedPayload {
  copies: Array<{
    sourceId: string;
    targetId: string;
    targetPath: string;
    targetParentId: string | null;
  }>;
}

export interface FSNodeRenamedPayload {
  nodes: Array<{
    nodeId: string;
    oldName: string;
    newName: string;
    oldPath: string;
    newPath: string;
  }>;
}

export interface FSMountPayload {
  mountPath: string;
  mountId: string;
  label?: string;
}

export interface FSErrorPayload {
  code: string;
  message: string;
  operation?: string;
  path?: string;
  details?: unknown;
}

// ═══════════════════════════════════════════════════════════════
// 类型映射
// ═══════════════════════════════════════════════════════════════

export interface FSEventPayloadMap {
  'node:created': FSNodeCreatedPayload;
  'node:updated': FSNodeUpdatedPayload;
  'node:deleted': FSNodeDeletedPayload;
  'node:moved': FSNodeMovedPayload;
  'node:copied': FSNodeCopiedPayload;
  'node:renamed': FSNodeRenamedPayload;
  'mount:added': FSMountPayload;
  'mount:removed': FSMountPayload;
  'error': FSErrorPayload;
}

// ═══════════════════════════════════════════════════════════════
// 事件对象
// ═══════════════════════════════════════════════════════════════

export interface FSEvent<T extends FSEventType = FSEventType> {
  readonly type: T;
  readonly payload: T extends keyof FSEventPayloadMap ? FSEventPayloadMap[T] : unknown;
  readonly timestamp: number;
  /** 事件来源模块 */
  readonly moduleId?: string;
  /** 是否来自事务提交 */
  readonly fromTransaction?: boolean;
  /** 来源挂载点 ID */
  readonly mountId?: string;
}

// ═══════════════════════════════════════════════════════════════
// 事件发射器接口
// ═══════════════════════════════════════════════════════════════

export interface FSEventEmitter {
  /**
   * 订阅特定类型事件
   * @returns 取消订阅函数
   */
  on<E extends FSEventType>(
    event: E,
    callback: (event: FSEvent<E>) => void,
  ): () => void;

  /** 订阅所有事件 */
  onAny?(callback: (event: FSEvent) => void): () => void;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/storage/inode-store.ts
 * @desc Layer 1: 节点结构存储
 *
 * 负责文件系统的拓扑信息：节点存在性、父子关系、类型。
 * 不涉及内容或描述性元数据。
 */

import type { FSNodeType, FSNodeMetadata } from '../core/types';

// ═══════════════════════════════════════════════════════════════
// Inode 数据结构（存储层内部）
// ═══════════════════════════════════════════════════════════════

export interface StorageInode {
  /** 节点编号（后端内唯一） */
  ino: number;
  /** 文件类型 */
  type: FSNodeType;
  /**
   * 内容数据引用
   * - 普通文件：content blob 的 key/ref
   * - SeqFile：null（数据在 RecordStore 或序列化在 data 中）
   * - 目录/设备/链接：null
   */
  dataRef: string | null;
  /** 硬链接计数 */
  nlink: number;
  /** 文件大小（字节） */
  size: number;
  /** 创建时间戳 (ms) */
  createdAt: number;
  /** 修改时间戳 (ms) */
  modifiedAt: number;
  /** 版本号（乐观锁） */
  version: number;
  /** 符号链接目标 */
  symlinkTarget?: string;
  /** 设备处理器名称 */
  deviceName?: string;
  /** 内容哈希 */
  contentHash?: string;
  /** 记录文件索引列表 */
  recordIndexes?: string[];
  /** 扩展元数据 */
  metadata: FSNodeMetadata & {
    tags?: string[];
    icon?: string;
    mimeType?: string;
    assetDirIno?: number;
    ownerFileIno?: number;
    isAssetDir?: boolean;
  };
}

/** 目录条目（存储层） */
export interface StorageDirEntry {
  name: string;
  ino: number;
}

// ═══════════════════════════════════════════════════════════════
// Inode Store 接口
// ═══════════════════════════════════════════════════════════════

export interface IInodeStore {
  /** 获取 inode */
  getInode(ino: number): Promise<StorageInode | null>;
  /** 写入 inode */
  putInode(inode: StorageInode): Promise<void>;
  /** 删除 inode */
  deleteInode(ino: number): Promise<void>;
  /** 分配新 ino */
  allocateIno(): Promise<number>;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/storage/meta-store.ts
 * @desc Layer 2: 元数据存储（目录条目管理）
 *
 * 管理目录条目（父子关系映射）。
 * 元数据字段内嵌在 StorageInode.metadata 中，
 * 通过 IInodeStore.putInode/getInode 操作。
 */

import type { StorageDirEntry } from './inode-store';

export interface IMetaStore {
  /** 获取目录下的所有条目 */
  getDirEntries(parentIno: number): Promise<StorageDirEntry[]>;
  /** 添加目录条目 */
  putDirEntry(parentIno: number, entry: StorageDirEntry): Promise<void>;
  /** 删除目录条目 */
  deleteDirEntry(parentIno: number, name: string): Promise<void>;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/storage/content-store.ts
 * @desc Layer 3: 文件内容存储
 *
 * 纯二进制内容的 CRUD。
 * 不了解文件类型或元数据。
 */

export interface IContentStore {
  /** 读取内容 */
  getData(ref: string): Promise<ArrayBuffer | null>;
  /** 写入内容 */
  putData(ref: string, data: ArrayBuffer): Promise<void>;
  /** 删除内容 */
  deleteData(ref: string): Promise<void>;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/storage/record-backend.ts
 * @desc 可选增强：SeqFile/Record 原生字段级操作
 *
 * DB 后端实现此接口可利用索引加速字段级查询。
 * 未实现时 VFS Engine 退化为整体 JSON 序列化。
 */

export type RecordValue =
  | string
  | number
  | boolean
  | null
  | RecordValue[]
  | { [key: string]: RecordValue };

export type QueryOperator = '=' | '!=' | '<' | '>' | '<=' | '>=' | 'in' | 'contains';

export interface RecordQuery {
  field: string;
  operator: QueryOperator;
  value: RecordValue;
}

export interface RecordQueryOptions {
  limit?: number;
  offset?: number;
}

export interface RecordQueryResult {
  field: string;
  value: RecordValue;
}

export interface IRecordStore {
  getField(ino: number, field: string): Promise<RecordValue | undefined>;
  setField(ino: number, field: string, value: RecordValue): Promise<void>;
  deleteField(ino: number, field: string): Promise<void>;
  getAllFields(ino: number): Promise<Record<string, RecordValue>>;
  setAllFields(ino: number, fields: Record<string, RecordValue>): Promise<void>;
  clearFields(ino: number): Promise<void>;
  listFields(ino: number): Promise<string[]>;
  createIndex(ino: number, field: string): Promise<void>;
  deleteIndex(ino: number, field: string): Promise<void>;
  queryFields(
    ino: number,
    query: RecordQuery,
    options?: RecordQueryOptions,
  ): Promise<RecordQueryResult[]>;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/storage/high-level-backend.ts
 * @desc 可选增强：远程后端聚合操作
 *
 * 远程后端（如 S3、REST API）实现此接口减少网络往返。
 * VFS Engine 优先使用这些方法（如果存在），回退到基础三层接口。
 */

import type { StorageInode } from './inode-store';

export interface IHighLevelStore {
  /** 按路径读取（一次往返获取 inode + data） */
  readByPath?(path: string): Promise<{ inode: StorageInode; data: ArrayBuffer } | null>;
  /** 按路径写入 */
  writeByPath?(
    path: string,
    data: ArrayBuffer,
    metadata?: Record<string, unknown>,
  ): Promise<StorageInode>;
  /** 按路径列目录 */
  listByPath?(path: string): Promise<Array<{ name: string; inode: StorageInode }>>;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/storage/syncable-backend.ts
 * @desc 可选增强：同步变更日志
 *
 * 后端实现此接口表示能高效地提供变更日志，
 * 而不需要 SyncService 通过事件推断。
 *
 * 例如：
 * - PostgreSQL: WAL 或 trigger
 * - S3: S3 Event Notification
 * - 本地 FS: inotify / FSEvents
 */

import type { ISyncAdapter, SyncChangeEntry } from '../sync/sync';

export interface ISyncableStore {
  /** 获取自某个序列号以来的变更 */
  getChangesSince(seq: number, limit?: number): Promise<SyncChangeEntry[]>;
  /** 获取当前最新序列号 */
  getLatestSeq(): Promise<number>;
  /** 获取此后端的同步适配器（可选） */
  getSyncAdapter?(): ISyncAdapter;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/storage/backend.ts
 * @desc 存储后端主接口 — 组合三层 + 事务 + 自描述
 *
 * 实现指南：
 * - SQLite: 三层在同一个 DB 事务中，天然 ACID
 * - IndexedDB: 三层在同一个 IDB transaction 中
 * - 文件系统: inode → JSON 文件，data → 原始文件，dir → 目录结构
 * - S3: inode/meta → DynamoDB，data → S3 object
 *
 * 可选增强通过类型守卫检测：
 *   isRecordBackend(backend) → IRecordStore 可用
 *   isHighLevelBackend(backend) → IHighLevelStore 可用
 *   isSyncableBackend(backend) → ISyncableStore 可用
 */

import type { IInodeStore } from './inode-store';
import type { IMetaStore } from './meta-store';
import type { IContentStore } from './content-store';
import type { IRecordStore } from './record-backend';
import type { IHighLevelStore } from './high-level-backend';
import type { ISyncableStore } from './syncable-backend';

// ═══════════════════════════════════════════════════════════════
// 后端能力自描述
// ═══════════════════════════════════════════════════════════════

export interface BackendFeatures {
  /** 是否支持真正的 ACID 事务 */
  transactions: boolean;
  /** 是否支持部分读取 */
  partialRead: boolean;
  /** 是否支持部分写入 */
  partialWrite: boolean;
  /** 是否支持 SeqFile 原生操作 (IRecordStore) */
  seqFiles: boolean;
  /** 是否支持引用存储 */
  refs: boolean;
  /** 是否支持 watch / 文件变更通知 */
  watch: boolean;
  /** 是否本地持久化（断网可用） */
  localPersistent: boolean;
  /** 是否远程存储 */
  remote: boolean;
  /** 是否提供同步适配器 */
  syncAdapter: boolean;
}

export interface BackendDescriptor {
  /** 后端类型标识（如 'indexeddb', 's3', 'sqlite', 'memory'） */
  readonly type: string;
  /** 人类可读名称 */
  readonly displayName: string;
  /** 后端能力声明 */
  readonly features: BackendFeatures;
}

// ═══════════════════════════════════════════════════════════════
// 核心存储后端接口
// ═══════════════════════════════════════════════════════════════

/**
 * 所有存储后端必须实现的最小接口
 *
 * 职责边界：
 * - 只负责 inode / data blob / dir entry 的 CRUD
 * - 不了解路径语义、挂载、模块、权限
 * - 不触发事件（事件由上层 VFS Engine 负责）
 */
export interface IStorageBackend {
  /** 后端自描述 */
  readonly descriptor: BackendDescriptor;

  /** Layer 1: 节点结构 */
  readonly inodes: IInodeStore;
  /** Layer 2: 目录条目 */
  readonly meta: IMetaStore;
  /** Layer 3: 文件内容 */
  readonly content: IContentStore;

  // ── 生命周期 ──

  /** 初始化（建表、建目录等） */
  init(): Promise<void>;
  /** 关闭清理 */
  close(): Promise<void>;

  // ── 事务 ──

  /**
   * 在事务中执行操作
   *
   * 后端保证事务内所有操作要么全部成功，要么全部回滚。
   * 不支持事务的后端可提供透传实现（fn 直接执行，不包装）。
   *
   * @param mode 事务模式
   * @param fn 事务体
   */
  runInTransaction<T>(
    mode: 'readonly' | 'readwrite',
    fn: (backend: IStorageBackend) => Promise<T>,
  ): Promise<T>;
}

// ═══════════════════════════════════════════════════════════════
// 可选增强的复合接口
// ═══════════════════════════════════════════════════════════════

export interface IRecordBackend extends IStorageBackend {
  readonly records: IRecordStore;
}

export interface IHighLevelBackend extends IStorageBackend, IHighLevelStore {}

export interface ISyncableBackend extends IStorageBackend, ISyncableStore {}

// ═══════════════════════════════════════════════════════════════
// 类型守卫
// ═══════════════════════════════════════════════════════════════

export function isRecordBackend(
  backend: IStorageBackend,
): backend is IRecordBackend {
  return 'records' in backend && (backend as IRecordBackend).records != null;
}

export function isHighLevelBackend(
  backend: IStorageBackend,
): backend is IHighLevelBackend {
  return 'readByPath' in backend || 'writeByPath' in backend || 'listByPath' in backend;
}

export function isSyncableBackend(
  backend: IStorageBackend,
): backend is ISyncableBackend {
  return 'getChangesSince' in backend && 'getLatestSeq' in backend;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/storage/index.ts
 * @desc 存储层统一导出
 */

// Layer 1
export type { StorageInode, StorageDirEntry, IInodeStore } from './inode-store';

// Layer 2
export type { IMetaStore } from './meta-store';

// Layer 3
export type { IContentStore } from './content-store';

// 可选增强
export type {
  RecordValue,
  QueryOperator,
  RecordQuery,
  RecordQueryOptions,
  RecordQueryResult,
  IRecordStore,
} from './record-backend';

export type { IHighLevelStore } from './high-level-backend';
export type { ISyncableStore } from './syncable-backend';

// 主接口
export type {
  BackendFeatures,
  BackendDescriptor,
  IStorageBackend,
  IRecordBackend,
  IHighLevelBackend,
  ISyncableBackend,
} from './backend';

export {
  isRecordBackend,
  isHighLevelBackend,
  isSyncableBackend,
} from './backend';
```

---

```typescript
/**
 * @file common/interfaces/fs/capabilities/seq-file.ts
 * @desc SeqFile 键值操作子接口
 *
 * 通过 IModuleFS.seq 访问（当 capabilities.seqFiles === true）。
 *
 * SeqFile 是 type=value 结构的文件，用于配置、SRS 状态等。
 * 当底层后端实现了 IRecordStore 时，操作直接映射到 DB 索引查询。
 * 否则退化为整体 JSON 反序列化后内存操作。
 */

import type { SeqFileEntry } from '../core/types';
import type { RecordQuery, RecordQueryOptions, RecordQueryResult } from '../storage/record-backend';

export interface ISeqFileOperations {
  /** 获取单个字段 */
  getEntry(fileIdOrPath: string, key: string): Promise<string | null>;

  /** 批量获取字段 */
  getEntries(fileIdOrPath: string, keys: string[]): Promise<Record<string, string>>;

  /** 获取所有字段 */
  getAllEntries(fileIdOrPath: string): Promise<SeqFileEntry[]>;

  /** 设置单个字段 */
  setEntry(fileIdOrPath: string, key: string, value: string): Promise<void>;

  /** 批量设置字段（合并模式） */
  setEntries(fileIdOrPath: string, entries: Record<string, string>): Promise<void>;

  /** 删除字段 */
  deleteEntry(fileIdOrPath: string, key: string): Promise<void>;

  /** 检查字段是否存在 */
  hasEntry(fileIdOrPath: string, key: string): Promise<boolean>;

  /**
   * 查询字段（需要后端支持 IRecordStore）
   * 不支持时抛出 FSCapabilityError。
   */
  queryEntries?(
    fileIdOrPath: string,
    query: RecordQuery,
    options?: RecordQueryOptions,
  ): Promise<RecordQueryResult[]>;

  /** 创建字段索引（需要后端支持 IRecordStore） */
  createIndex?(fileIdOrPath: string, field: string): Promise<void>;

  /** 删除字段索引 */
  deleteIndex?(fileIdOrPath: string, field: string): Promise<void>;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/capabilities/asset-ops.ts
 * @desc AssetDir 资产目录操作子接口
 *
 * 通过 IModuleFS.assets 访问（当 capabilities.assets === true）。
 *
 * 命名约定：文件 "report.md" 的资产目录为同级 "_report.md/"
 *
 * 生命周期：
 * - 首次 putAsset 时自动创建 assetdir
 * - 宿主文件删除时默认级联删除
 * - 宿主文件重命名/移动时自动跟随
 */

import type { FSNode, FileContent } from '../core/types';

export interface IAssetOperations {
  /**
   * 写入资产（assetdir 不存在则自动创建）
   *
   * 仅适用于 file / seqfile 类型节点。
   *
   * @param ownerIdOrPath 宿主文件
   * @param assetName 资产文件名
   * @param content 内容
   * @throws FSError('EISDIR') owner 是目录
   */
  putAsset(
    ownerIdOrPath: string,
    assetName: string,
    content: FileContent,
  ): Promise<FSNode>;

  /**
   * 读取资产
   * @returns 不存在返回 null
   */
  getAsset(
    ownerIdOrPath: string,
    assetName: string,
  ): Promise<FileContent | null>;

  /** 获取 assetdir 节点 ID，不存在返回 null */
  getAssetDirId(ownerIdOrPath: string): Promise<string | null>;

  /** 确保 assetdir 存在（幂等） */
  ensureAssetDir(ownerIdOrPath: string): Promise<string>;

  /**
   * 列出资产文件名
   * @param includeHidden 是否包含隐藏文件 @default false
   */
  listAssets(ownerIdOrPath: string, includeHidden?: boolean): Promise<string[]>;

  /** 删除单个资产 */
  deleteAsset(ownerIdOrPath: string, assetName: string): Promise<void>;

  /**
   * 删除整个 assetdir
   * @param removeContent 是否删除内容 @default true
   */
  removeAssetDir(ownerIdOrPath: string, removeContent?: boolean): Promise<void>;

  /** 检查 assetdir 是否存在 */
  hasAssetDir(ownerIdOrPath: string): Promise<boolean>;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/capabilities/tag-ops.ts
 * @desc 标签操作子接口
 *
 * 通过 IModuleFS.tags 访问（当 capabilities.tags === true）。
 */

export interface TagDefinition {
  name: string;
  color?: string;
}

export interface ITagOperations {
  /** 获取本模块所有标签定义 */
  getAllTags(): Promise<TagDefinition[]>;

  /**
   * 设置节点标签（全量替换）。空数组清除所有标签。
   * @emits node:updated { changedFields: ['tags'] }
   */
  setTags(idOrPath: string, tags: string[]): Promise<void>;

  /** 添加标签（增量） */
  addTag(idOrPath: string, tag: string): Promise<void>;

  /** 移除标签 */
  removeTag(idOrPath: string, tag: string): Promise<void>;

  /** 按标签查找节点 ID */
  findByTag(tag: string): Promise<string[]>;

  /** 更新标签定义（如颜色），不影响节点关联关系 */
  updateTagDefinition?(
    tagName: string,
    updates: Partial<Omit<TagDefinition, 'name'>>,
  ): Promise<void>;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/capabilities/ref-ops.ts
 * @desc 双向引用操作子接口
 *
 * 通过 IModuleFS.refs 访问（当 capabilities.references === true）。
 *
 * 引用统一存储在 root backend 中（全局关系，不分散到各后端）。
 * 所有方法接受路径参数，内部解析为全局 ID。
 */

export type RefType = 'mention' | 'depend' | 'related' | 'embed';

export interface Reference {
  readonly sourceId: string;
  readonly targetId: string;
  readonly refType: RefType;
  readonly createdAt: number;
  extra?: Record<string, unknown>;
}

export interface RefQueryOptions {
  refTypes?: RefType[];
  limit?: number;
  offset?: number;
}

export interface IRefOperations {
  /** 添加引用 */
  addRef(
    sourceIdOrPath: string,
    targetIdOrPath: string,
    refType: RefType,
    extra?: Record<string, unknown>,
  ): Promise<void>;

  /** 移除引用 */
  removeRef(
    sourceIdOrPath: string,
    targetIdOrPath: string,
    refType: RefType,
  ): Promise<void>;

  /** 查询从此节点出发的引用 */
  getOutgoing(idOrPath: string, opts?: RefQueryOptions): Promise<Reference[]>;

  /** 查询指向此节点的引用（backlinks） */
  getIncoming(idOrPath: string, opts?: RefQueryOptions): Promise<Reference[]>;

  /** 检查引用是否存在 */
  hasRef(
    sourceIdOrPath: string,
    targetIdOrPath: string,
    refType: RefType,
  ): Promise<boolean>;

  /**
   * 全量同步引用（替换 source 的所有出向引用）
   * 用于内容解析后批量更新。
   */
  syncOutgoing(
    sourceIdOrPath: string,
    refs:Array<{
      targetIdOrPath: string;
      refType: RefType;
      extra?: Record<string, unknown>;
    }>,
  ): Promise<void>;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/capabilities/watch.ts
 * @desc 文件变更监听子接口
 *
 * 当 capabilities.watch === true 时通过 IModuleFS.watcher 访问。
 */

import type { WatchOptions } from '../core/options';

export interface FileChangeEvent {
  type: 'create' | 'modify' | 'delete' | 'rename' | 'metadata';
  path: string;
  oldPath?: string;
  timestamp: number;
}

export interface Watcher {
  /** 停止监听 */
  close(): void;
}

export interface IWatchable {
  /**
   * 监听路径变更
   *
   * @param idOrPath 要监听的文件或目录
   * @param callback 变更回调
   * @param options 选项
   * @returns Watcher 实例（调用 close() 停止监听）
   */
  watch(
    idOrPath: string,
    callback: (event: FileChangeEvent) => void,
    options?: WatchOptions,
  ): Watcher;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/device/device.ts
 * @desc 虚拟设备驱动接口
 *
 * 设计：
 * - sessionable 设备需先 open() 获取 sessionId，再 read/write
 * - 无状态设备直接 read/write，忽略 sessionId
 * - readStream 使用 AsyncIterable，贴合 LLM 流式响应
 * - ioctl 提供通用控制命令接口
 *
 * 多 LLM 示例：
 *   /dev/llm/openai  → handlerId: 'llm-openai'
 *   /dev/llm/claude  → handlerId: 'llm-claude'
 */

import type { FileContent } from '../core/types';

// ═══════════════════════════════════════════════════════════════
// 设备操作上下文
// ═══════════════════════════════════════════════════════════════

export interface DeviceContext {
  /** 设备节点 ID */
  nodeId: string;
  /** 设备节点名称 */
  name: string;
  /** 节点元数据 */
  metadata?: Record<string, unknown>;
  /**
   * 会话 ID
   * - 无状态设备（/dev/null, /dev/random）：忽略
   * - 有状态设备（/dev/llm/*）：通过 open() 获取
   */
  sessionId?: string;
}

// ═══════════════════════════════════════════════════════════════
// 设备驱动接口
// ═══════════════════════════════════════════════════════════════

export interface IDeviceDriver {
  /** 处理器唯一标识符，对应 FSDeviceNode.deviceHandlerId */
  readonly handlerId: string;
  /** 人类可读描述 */
  readonly description?: string;
  /** 是否支持写入 */
  readonly writable: boolean;
  /** 是否支持流式读取 */
  readonly streamable?: boolean;
  /**
   * 是否支持多会话
   * true: 需先 open() 获取 sessionId
   * false: 无状态，直接 read/write
   */
  readonly sessionable?: boolean;

  // ── 会话管理 ──

  /**
   * 打开会话
   * @returns 会话 ID
   */
  open?(ctx: DeviceContext, options?: Record<string, unknown>): Promise<string>;

  /** 关闭会话 */
  close?(ctx: DeviceContext): Promise<void>;

  // ── I/O ──

  /** 读取设备内容 */
  read(ctx: DeviceContext): Promise<FileContent>;

  /** 写入设备内容 */
  write(ctx: DeviceContext, content: FileContent): Promise<void>;

  /** 流式读取（需要 streamable === true） */
  readStream?(ctx: DeviceContext): AsyncIterable<string | ArrayBuffer>;

  // ── 控制 ──

  /** 设备控制命令 */
  ioctl?(ctx: DeviceContext, command: string | number, arg?: unknown): Promise<unknown>;

  // ── 生命周期 ──

  /** 设备初始化 */
  init?(): Promise<void>;

  /** 设备销毁（实现应关闭所有活跃会话） */
  dispose?(): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════
// 设备管理器接口
// ═══════════════════════════════════════════════════════════════

export interface IDeviceManager {
  register(driver: IDeviceDriver): void;
  unregister(handlerId: string): void;
  has(handlerId: string): boolean;
  get(handlerId: string): IDeviceDriver;
  list(): string[];
}
```

---

```typescript
/**
 * @file common/interfaces/fs/plugin/plugin.ts
 * @desc 插件与中间件系统
 *
 * 采用 Koa 风格中间件管道：
 *   request → plugin1 → plugin2 → ... → core op → ... → plugin2 → plugin1 → response
 *
 * 插件可以：
 * - 在操作前修改参数（如内容加密）
 * - 在操作后修改结果（如内容解密）
 * - 短路操作（如缓存命中、权限拒绝）
 * - 执行副作用（如写入 assetdir 状态、版本快照）
 *
 * 不调用 next() 则短路（核心操作不执行）。
 */

// ═══════════════════════════════════════════════════════════════
// 操作上下文
// ═══════════════════════════════════════════════════════════════

export interface OperationContext {
  /** 操作名称（如 'read', 'write', 'delete', 'create', 'rename'） */
  readonly operation: string;
  /** 操作路径 */
  readonly path: string;
  /** 当前模块 ID */
  readonly moduleId: string;
  /** 节点 ID（已存在节点的操作） */
  readonly nodeId?: string;
  /** 操作参数（operation-specific） */
  args: Record<string, unknown>;
  /** 操作结果（after 阶段填充） */
  result?: unknown;
  /** 插件间共享数据（按插件 ID 隔离） */
  readonly pluginData: Map<string, Record<string, unknown>>;
  /** 是否在事务内 */
  readonly inTransaction: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 中间件
// ═══════════════════════════════════════════════════════════════

/** 中间件 next 函数 */
export type MiddlewareNext = () => Promise<void>;

/**
 * 中间件处理函数
 *
 * @example
 * ```ts
 * async (ctx, next) => {
 *   console.log('before', ctx.operation);
 *   await next();
 *   console.log('after', ctx.operation, ctx.result);
 * }
 * ```
 */
export type MiddlewareHandler = (
  ctx: OperationContext,
  next: MiddlewareNext,
) => Promise<void>;

// ═══════════════════════════════════════════════════════════════
// 插件信息
// ═══════════════════════════════════════════════════════════════

export interface PluginInfo {
  readonly id: string;
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
}

// ═══════════════════════════════════════════════════════════════
// 插件接口
// ═══════════════════════════════════════════════════════════════

export interface IPlugin {
  readonly info: PluginInfo;

  /**
   * 执行优先级（数字越小越先执行）
   * @default 100
   */
  readonly priority?: number;

  /** 插件初始化 */
  init?(): Promise<void>;

  /** 插件销毁 */
  dispose?(): Promise<void>;

  /**
   * 中间件处理函数（可选）
   *
   * 提供此方法的插件会被注册到中间件管道中。
   * 未提供则插件仅参与生命周期，不拦截操作。
   */
  middleware?: MiddlewareHandler;

  /**
   * 声明此插件关注的操作列表（可选）
   *
   * 未声明时，中间件对所有操作生效。
   * 声明后，仅匹配的操作会经过此插件的中间件。
   *
   * @example ['read', 'write', 'delete']
   */
  operations?: string[];
}

// ═══════════════════════════════════════════════════════════════
// 插件管理器接口
// ═══════════════════════════════════════════════════════════════

export interface IPluginManager {
  /** 注册插件 */
  register(plugin: IPlugin): Promise<void>;
  /** 注销插件 */
  unregister(pluginId: string): Promise<void>;
  /** 获取插件实例 */
  get<T extends IPlugin = IPlugin>(pluginId: string): T | null;
  /** 列出所有已注册插件 */
  list(): PluginInfo[];
  /** 获取构建好的中间件管道（内部使用） */
  buildPipeline(operation: string): MiddlewareHandler[];
}
```

---

```typescript
/**
 * @file common/interfaces/fs/mount/mount.ts
 * @desc 挂载系统 — 将逻辑路径树映射到多个物理存储后端
 *
 * 核心规则：
 * 1. "/" 必须始终有一个挂载（root backend），不可卸载
 * 2. 挂载点按路径深度降序匹配（最长前缀优先）
 * 3. 挂载点不可重叠（同一路径不可挂载两次）
 * 4. 子挂载点完全遮蔽父挂载点在该子树下的数据
 * 5. 跨挂载点 move/rename 降级为 copy + delete
 */

import type { IStorageBackend } from '../storage/backend';

// ═══════════════════════════════════════════════════════════════
// 挂载点
// ═══════════════════════════════════════════════════════════════

export interface MountPoint {
  /** 挂载点唯一 ID（系统生成） */
  readonly id: string;
  /** 挂载路径（如 '/module/archive'） */
  readonly path: string;
  /** 存储后端实例 */
  readonly backend: IStorageBackend;
  /** 人类可读标签 */
  readonly label?: string;
  /** 是否只读 */
  readonly readOnly: boolean;
  /** 是否可同步 */
  readonly syncable: boolean;
  /** 同步配置 */
  readonly syncConfig?: MountSyncConfig;
  /** 挂载时间 */
  readonly mountedAt: number;
  /** 挂载选项快照 */
  readonly options: MountOptions;
}

// ═══════════════════════════════════════════════════════════════
// 挂载选项
// ═══════════════════════════════════════════════════════════════

export interface MountOptions {
  /** 人类可读标签 */
  label?: string;
  /** 是否只读 @default false */
  readOnly?: boolean;
  /**
   * 是否可同步
   * 为 true 时该挂载点的变更会被 ISyncService 追踪。
   * @default false
   */
  syncable?: boolean;
  /** 同步配置 */
  syncConfig?: MountSyncConfig;
  /**
   * 是否持久化挂载记录
   * 为 true 时 VFS 重启后自动恢复此挂载。
   * @default true
   */
  persistent?: boolean;
  /**
   * 跨挂载点操作策略
   * @default 'copy-delete'
   */
  crossMountStrategy?: 'copy-delete' | 'deny';
}

export interface MountSyncConfig {
  /** 同步方向 */
  direction: 'push' | 'pull' | 'bidirectional';
  /** 同步策略 */
  strategy: 'immediate' | 'batch' | 'manual';
  /** 批量同步间隔 (ms)，strategy='batch' 时生效 */
  batchIntervalMs?: number;
  /** 冲突解决策略 */
  conflictResolution: 'local-wins' | 'remote-wins' | 'manual' | 'newest-wins';
  /** 远端标识（如 S3 bucket 名、服务器 URL 等） */
  remoteId?: string;
}

// ═══════════════════════════════════════════════════════════════
// 路径解析结果
// ═══════════════════════════════════════════════════════════════

export interface ResolvedMount {
  /** 匹配到的挂载点 */
  mount: MountPoint;
  /** 在该后端内的相对路径 */
  relativePath: string;
}

// ═══════════════════════════════════════════════════════════════
// 挂载事件
// ═══════════════════════════════════════════════════════════════

export type MountEventType = 'mount:added' | 'mount:removed' | 'mount:error';

export interface MountEvent {
  type: MountEventType;
  mountPoint: MountPoint;
  timestamp: number;
  error?: Error;
}

// ═══════════════════════════════════════════════════════════════
// 挂载路由器
// ═══════════════════════════════════════════════════════════════

export interface IMountRouter {
  /**
   * 添加挂载点
   * @throws FSError('EEXIST') 路径已被挂载
   * @throws FSError('EINVAL') 路径格式无效
   */
  mount(path: string, backend: IStorageBackend, options?: MountOptions): MountPoint;

  /**
   * 移除挂载点
   * @throws FSError('EINVAL') 不可卸载根挂载
   * @throws FSError('EBUSY') 有活跃操作
   */
  unmount(path: string): void;

  /**
   * 解析路径到挂载点（最长前缀匹配）
   */
  resolve(absolutePath: string): ResolvedMount;

  /** 检查两个路径是否在同一挂载点 */
  isSameMount(path1: string, path2: string): boolean;

  /** 列出所有挂载点 */
  listMounts(): MountPoint[];

  /** 获取指定路径的挂载点 */
  getMountAt(path: string): MountPoint | null;

  /** 获取指定挂载点下的所有子挂载点 */
  getChildMounts(path: string): MountPoint[];

  /** 订阅挂载变更事件 */
  onMountChange(handler: (event: MountEvent) => void): () => void;
}

// ═══════════════════════════════════════════════════════════════
// 后端工厂（恢复持久化挂载时使用）
// ═══════════════════════════════════════════════════════════════

/**
 * 持久化挂载记录
 *
 * 存储在 root backend 的 /etc/.mounts 中。
 * 不存储 backend 实例，只存储重建所需的信息。
 */
export interface MountRecord {
  mountPath: string;
  backendType: string;
  backendConfig: Record<string, unknown>;
  options: MountOptions;
  createdAt: number;
}

export interface IBackendFactory {
  register(
    backendType: string,
    creator: (config: Record<string, unknown>) => IStorageBackend,
  ): void;
  create(backendType: string, config: Record<string, unknown>): IStorageBackend;
  hasType(backendType: string): boolean;
  listTypes(): string[];
}
```

---

```typescript
/**
 * @file common/interfaces/fs/sync/sync.ts
 * @desc 同步系统 — 跨后端数据同步
 *
 * SyncService 是 VFS 的消费者（非内核），通过监听文件变更事件
 * 构建 changelog，按策略推送/拉取变更。
 *
 * 同步流程：
 *   VFS Engine ── FSEvent ──► SyncService ── ISyncAdapter ──► 远端
 */

import type { FSEvent } from '../core/events';

// ═══════════════════════════════════════════════════════════════
// 变更日志
// ═══════════════════════════════════════════════════════════════

export interface SyncChangeEntry {
  /** 挂载点 ID */
  mountId: string;
  /** 相对于挂载点的路径 */
  path: string;
  /** 操作类型 */
  operation: 'create' | 'modify' | 'delete' | 'rename';
  /** 重命名场景下的旧路径 */
  oldPath?: string;
  /** 操作时的节点版本 */
  version: number;
  /** 内容哈希（用于冲突检测） */
  contentHash?: string;
  /** 操作时间 */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 同步状态
// ═══════════════════════════════════════════════════════════════

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'conflict' | 'paused';

export interface SyncProgress {
  mountId: string;
  direction: 'push' | 'pull' | 'bidirectional';
  status: SyncStatus;
  totalChanges: number;
  processedChanges: number;
  conflictCount: number;
  startedAt: number;
  estimatedRemainingMs?: number;
  currentFile?: string;
}

// ═══════════════════════════════════════════════════════════════
// 冲突
// ═══════════════════════════════════════════════════════════════

export interface SyncConflict {
  readonly id: string;
  readonly mountId: string;
  readonly path: string;
  readonly localChange: SyncChangeEntry;
  readonly remoteChange: SyncChangeEntry;
  readonly detectedAt: number;
}

export type SyncConflictResolution =
  | { strategy: 'keep-local' }
  | { strategy: 'keep-remote' }
  | { strategy: 'keep-both'; localSuffix?: string; remoteSuffix?: string }
  | { strategy: 'merge'; mergedContent: string | ArrayBuffer };

// ═══════════════════════════════════════════════════════════════
// 同步结果
// ═══════════════════════════════════════════════════════════════

export interface SyncResult {
  mountId: string;
  direction: 'push' | 'pull' | 'bidirectional';
  success: boolean;
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: Array<{ path: string; error: string }>;
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════
// 同步选项
// ═══════════════════════════════════════════════════════════════

export interface SyncOptions {
  /** 仅同步特定挂载点 */
  mountIds?: string[];
  /** 覆盖方向 */
  direction?: 'push' | 'pull' | 'bidirectional';
  /** 试运行（不实际写入） */
  dryRun?: boolean;
  /** 全量同步（忽略 changelog，重新比较） */
  fullSync?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 同步适配器（每种后端类型提供一个实现）
// ═══════════════════════════════════════════════════════════════

export interface ISyncAdapter {
  readonly adapterId: string;

  /** 获取远端自指定时间以来的变更 */
  getRemoteChanges(since: number): Promise<SyncChangeEntry[]>;

  /** 推送本地变更到远端 */
  pushChanges(changes: SyncChangeEntry[]): Promise<{
    succeeded: string[];
    failed: Array<{ path: string; error: string }>;
  }>;

  /** 从远端拉取变更到本地 */
  pullChanges(changes: SyncChangeEntry[]): Promise<{
    succeeded: string[];
    failed: Array<{ path: string; error: string }>;
  }>;

  /** 获取远端文件的版本/哈希信息（冲突检测用） */
  getRemoteVersion(path: string): Promise<{
    version: number;
    contentHash?: string;
    modifiedAt: number;
  } | null>;
}

// ═══════════════════════════════════════════════════════════════
// 同步服务
// ═══════════════════════════════════════════════════════════════

export interface ISyncService {
  /** 获取所有挂载点的同步状态 */
  getStatus(): Map<string, SyncStatus>;

  /** 获取特定挂载点的同步状态 */
  getMountSyncStatus(mountId: string): SyncStatus;

  /** 触发同步 */
  sync(options?: SyncOptions): Promise<SyncResult[]>;

  /** 获取待同步的变更列表 */
  getPendingChanges(mountId?: string): Promise<SyncChangeEntry[]>;

  /** 获取未解决的冲突列表 */
  getConflicts(mountId?: string): Promise<SyncConflict[]>;

  /** 解决单个冲突 */
  resolveConflict(conflictId: string, resolution: SyncConflictResolution): Promise<void>;

  /** 批量解决冲突 */
  resolveAllConflicts(mountId: string, resolution: SyncConflictResolution): Promise<number>;

  /** 暂停同步 */
  pause(mountId?: string): void;

  /** 恢复同步 */
  resume(mountId?: string): void;

  /** 注册同步适配器 */
  registerAdapter(mountId: string, adapter: ISyncAdapter): void;

  /** 注销同步适配器 */
  unregisterAdapter(mountId: string): void;

  /** 接收文件变更事件（由 VFS Engine 调用） */
  handleFSEvent(event: FSEvent, mountId: string): void;

  // ── 事件订阅 ──

  onProgress(handler: (progress: SyncProgress) => void): () => void;
  onConflict(handler: (conflict: SyncConflict) => void): () => void;
  onComplete(handler: (result: SyncResult) => void): () => void;

  /** 关闭同步服务 */
  dispose(): Promise<void>;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/services/module-fs.ts
 * @desc 模块文件系统接口 — 模块/Agent 的唯一入口
 *
 * 设计原则：
 * - 核心方法 ~20 个（精简），足够日常操作，不臃肿
 * - 扩展能力通过子接口暴露：assets / tags / seq / refs / watcher
 * - 所有 idOrPath 参数统一支持 ID 或路径（以 '/' 开头视为路径）
 * - 事务通过闭包 API，保证 commit/rollback 自动执行
 * - 模块看到的路径已经过 chroot 映射
 */

import type {
  FSNode,
  FSSearchQuery,
  FSCapabilities,
  FSModuleStats,
  DirEntry,
  FileContent,
} from '../core/types';

import type {
  ReadOptions,
  WriteOptions,
  CreateFileOptions,
  CreateDirectoryOptions,
  DeleteOptions,
  RenameOptions,
  MoveOptions,
  CopyOptions,
  ListOptions,
  TreeWalkOptions,
  TreeWalkCallback,
} from '../core/options';

import type { FSEventType, FSEvent, FSEventEmitter } from '../core/events';
import type { ISeqFileOperations } from '../capabilities/seq-file';
import type { IAssetOperations } from '../capabilities/asset-ops';
import type { ITagOperations } from '../capabilities/tag-ops';
import type { IRefOperations } from '../capabilities/ref-ops';
import type { IWatchable } from '../capabilities/watch';
import type { IDeviceDriver } from '../device/device';

// ═══════════════════════════════════════════════════════════════
// 事务
// ═══════════════════════════════════════════════════════════════

/**
 * 事务操作接口
 *
 * 与 IModuleFS 核心方法签名一致，消费方无需学习新 API。
 * 事务内的事件在 commit 后合并触发。
 */
export interface IFSTransaction {
  getNode(idOrPath: string): Promise<FSNode | null>;
  readContent(idOrPath: string, options?: ReadOptions): Promise<FileContent>;
  createFile(options: CreateFileOptions): Promise<FSNode>;
  createDirectory(options: CreateDirectoryOptions): Promise<FSNode>;
  writeContent(
    idOrPath: string,
    content: FileContent,
    options?: WriteOptions,
  ): Promise<void>;
  rename(idOrPath: string, newName: string, options?: RenameOptions): Promise<void>;
  move(
    idsOrPaths: string[],
    targetParentIdOrPath: string | null,
    options?: MoveOptions,
  ): Promise<void>;
  delete(idsOrPaths: string[], options?: DeleteOptions): Promise<void>;
  updateMetadata(
    idOrPath: string,
    metadata: Record<string, unknown>,
  ): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════
// 核心接口
// ═══════════════════════════════════════════════════════════════

export interface IModuleFS extends FSEventEmitter {
  /** 当前模块 ID */
  readonly moduleId: string;

  /** 能力声明 */
  readonly capabilities: FSCapabilities;

  // ── 可选能力子接口 ──

  /** 资产操作（capabilities.assets === true） */
  readonly assets?: IAssetOperations;
  /** 标签操作（capabilities.tags === true） */
  readonly tags?: ITagOperations;
  /** SeqFile 操作（capabilities.seqFiles === true） */
  readonly seq?: ISeqFileOperations;
  /** 双向引用（capabilities.references === true） */
  readonly refs?: IRefOperations;
  /** 文件监听（capabilities.watch === true） */
  readonly watcher?: IWatchable;

  // ==================== 生命周期 ====================

  /** 初始化（幂等） */
  init(): Promise<void>;
  /** 销毁（幂等） */
  dispose?(): Promise<void>;

  // ==================== 读取操作 ====================

  /**
   * 获取节点详情
   * @param idOrPath 以 '/' 开头视为路径，否则视为 ID
   */
  getNode(idOrPath: string): Promise<FSNode | null>;

  /**
   * 获取直接子节点
   *
   * 最高频操作，所有后端必须高效实现：
   * - DB: WHERE parentId = ? (索引查询)
   * - FS: readdir()
   */
  getChildren(idOrPath: string, options?: ListOptions): Promise<FSNode[]>;

  /**
   * 读取文件内容
   * 设备文件自动委托给 IDeviceDriver。
   */
  readContent(idOrPath: string, options?: ReadOptions): Promise<FileContent>;

  /** 解析路径为节点 ID */
  resolvePath(path: string): Promise<string | null>;

  /** 检查路径是否存在 */
  exists(idOrPath: string): Promise<boolean>;

  /**
   * 遍历节点树（需要 capabilities.treeWalk）
   * @returns 遍历的节点总数
   */
  walkTree?(callback: TreeWalkCallback, options?: TreeWalkOptions): Promise<number>;

  /** 搜索当前模块内节点 */
  search(query: FSSearchQuery): Promise<FSNode[]>;

  /** 模块统计信息 */
  getStats?(): Promise<FSModuleStats>;

  // ==================== 写入操作 ====================

  /**
   * 创建文件
   * @emits node:created
   */
  createFile(options: CreateFileOptions): Promise<FSNode>;

  /**
   * 创建目录
   * @emits node:created
   */
  createDirectory(options: CreateDirectoryOptions): Promise<FSNode>;

  /**
   * 写入文件内容
   * 设备文件自动委托给 IDeviceDriver。
   * @emits node:updated { changedFields: ['content'] }
   */
  writeContent(
    idOrPath: string,
    content: FileContent,
    options?: WriteOptions,
  ): Promise<void>;

  /**
   * 追加内容
   * @emits node:updated { changedFields: ['content'] }
   */
  appendContent(idOrPath: string, content: FileContent): Promise<void>;

  /**
   * 重命名（assetdir 默认跟随）
   * @emits node:renamed
   */
  rename(idOrPath: string, newName: string, options?: RenameOptions): Promise<void>;

  /**
   * 移动节点（assetdir 默认跟随）
   * @emits node:moved
   */
  move(
    idsOrPaths: string[],
    targetParentIdOrPath: string | null,
    options?: MoveOptions,
  ): Promise<void>;

  /**
   * 删除节点（级联删除子节点和 assetdir）
   * @emits node:deleted
   */
  delete(idsOrPaths: string[], options?: DeleteOptions): Promise<void>;

  /**
   * 更新元数据（合并模式，不覆盖未传入的字段）
   * @emits node:updated { changedFields: ['metadata'] }
   */
  updateMetadata(
    idOrPath: string,
    metadata: Record<string, unknown>,
  ): Promise<void>;

  // ==================== 复制 ====================

  /**
   * 深度复制节点（含子节点和 assetdir）
   */
  copy?(
    sourceIdOrPath: string,
    targetParentIdOrPath: string | null,
    newName?: string,
    options?: CopyOptions,
  ): Promise<FSNode>;

  // ==================== 链接 ====================

  /**
   * 创建符号链接
   * @param linkPath 新链接的路径
   * @param targetPath 目标路径
   */
  symlink(linkPath: string, targetPath: string): Promise<FSNode>;

  /** 读取符号链接目标（不解析） */
  readlink(idOrPath: string): Promise<string>;

  /** 创建硬链接（需要 capabilities.hardlinks） */
  hardlink?(linkPath: string, targetPath: string): Promise<FSNode>;

  // ==================== 设备文件 ====================

  /** 注册设备处理器（capabilities.deviceFiles） */
  registerDeviceHandler?(handler: IDeviceDriver): void;

  /** 创建设备文件节点 */
  createDeviceFile?(
    name: string,
    parentIdOrPath: string | null,
    handlerId: string,
  ): Promise<FSNode>;

  /** 设备控制命令 */
  ioctl?(idOrPath: string, command: string | number, arg?: unknown): Promise<unknown>;

  // ==================== 事务 ====================

  /**
   * 在事务中执行多个操作
   *
   * 需要 capabilities.transaction === true。
   * 不支持时消费方可降级为逐个调用。
   *
   * 核心价值：
   * 1. 原子性：全部成功或全部回滚
   * 2. 性能：多操作合并为单次后端事务
   * 3. 事件合并：commit 后合并同类型事件为一次触发
   */
  transaction?<T>(fn: (tx: IFSTransaction) => Promise<T>): Promise<T>;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/services/config-service.ts
 * @desc 配置服务接口
 *
 * 从 IVFSManager 剥离，遵循 SRP。
 * 内部依赖 __config 模块的 seqfile 实现存储，
 * 但消费方不需要知道底层存储机制（DIP）。
 */

export interface ConfigFileDescriptor {
  /** 配置文件名（如 'app', 'theme', 'sync'） */
  name: string;
  /** 描述 */
  description?: string;
  /** 是否只读 */
  readonly?: boolean;
}

export interface ConfigChangeEvent {
  configName: string;
  key: string;
  oldValue?: string;
  newValue?: string;
}

export interface IConfigService {
  /** 列出所有配置文件 */
  listConfigs(): Promise<ConfigFileDescriptor[]>;

  // ── 读取 ──

  /** 获取配置值，不存在返回 null */
  get(configName: string, key: string): Promise<string | null>;

  /** 获取字符串值（带默认值） */
  getString(configName: string, key: string, defaultValue: string): Promise<string>;

  /** 获取数值（带默认值和类型转换） */
  getNumber(configName: string, key: string, defaultValue: number): Promise<number>;

  /** 获取布尔值（带默认值和类型转换） */
  getBoolean(configName: string, key: string, defaultValue: boolean): Promise<boolean>;

  /** 获取 JSON 对象（带默认值和类型转换） */
  getJson<T>(configName: string, key: string, defaultValue: T): Promise<T>;

  /** 获取配置文件所有键值对 */
  getAll(configName: string): Promise<Record<string, string>>;

  // ── 写入 ──

  /**
   * 设置配置值（配置文件不存在则自动创建）
   * @emits config:changed
   */
  set(configName: string, key: string, value: string): Promise<void>;

  /**
   * 批量设置（合并模式）
   * @emits config:changed（实现可合并为单次事务）
   */
  setBatch(configName: string, entries: Record<string, string>): Promise<void>;

  /** 删除配置键 */
  delete(configName: string, key: string): Promise<void>;

  // ── 订阅 ──

  /**
   * 订阅配置变更
   * @param configName '*' 表示所有配置文件
   * @returns 取消订阅函数
   */
  onChange(
    configName: string,
    handler: (event: ConfigChangeEvent) => void,
  ): () => void;
}
```

---

```typescript
/**
 * @file common/interfaces/fs/services/vfs-manager.ts
 * @desc 系统级 VFS 管理接口
 *
 * 职责边界：
 * ┌────────────────────┬──────────────────────────────────┐
 * │ IModuleFS          │ 模块内文件操作（chroot 隔离）      │
 * │ IConfigService     │ 配置管理                          │
 * │ IVFSManager        │ 模块生命周期 + 挂载 + 跨模块协调  │
 * └────────────────────┴──────────────────────────────────┘
 *
 * 设计决策：
 * - 仅保留 3 个高频便捷方法 read/write/exists（DX 友好且不膨胀）
 * - 其余操作通过 getEngine(moduleName).xxx()（DRY）
 * - 挂载管理通过 IMountRouter（SRP）
 * - 同步服务可选获取（YAGNI）
 */

import type { FSNode, FSSearchQuery, FSModuleStats, FileContent } from '../core/types';
import type { FSEventType, FSEvent } from '../core/events';
import type { IModuleFS } from './module-fs';
import type { IStorageBackend } from '../storage/backend';
import type { IMountRouter, MountPoint, MountOptions } from '../mount/mount';
import type { ISyncService } from '../sync/sync';
import type { IPlugin, PluginInfo } from '../plugin/plugin';

// ═══════════════════════════════════════════════════════════════
// 模块管理类型
// ═══════════════════════════════════════════════════════════════

export interface ModuleInfo {
  name: string;
  description?: string;
  rootNodeId?: string;
  isProtected?: boolean;
  syncEnabled?: boolean;
}

export interface ModuleMountOptions {
  description?: string;
  isProtected?: boolean;
  syncEnabled?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// VFS Manager 事件
// ═══════════════════════════════════════════════════════════════

export type VFSManagerEventType =
  | 'node:created'
  | 'node:updated'
  | 'node:deleted'
  | 'module:mounted'
  | 'module:unmounted'
  | 'mount:added'
  | 'mount:removed';

export interface VFSManagerEventPayloadMap {
  'node:created': { nodeId: string; path: string; moduleId: string };
  'node:updated': { nodeId: string; path: string; moduleId: string };
  'node:deleted': { nodeIds: string[]; moduleId: string };
  'module:mounted': { moduleName: string };
  'module:unmounted': { moduleName: string };
  'mount:added': { mountPath: string; mountId: string; label?: string };
  'mount:removed': { mountPath: string; mountId: string };
}

export interface VFSManagerEvent<
  T extends VFSManagerEventType = VFSManagerEventType,
> {
  type: T;
  payload: T extends keyof VFSManagerEventPayloadMap
    ? VFSManagerEventPayloadMap[T]
    : unknown;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 全局标签
// ═══════════════════════════════════════════════════════════════

export interface GlobalTagInfo {
  name: string;
  color?: string;
  refCount?: number;
}

// ═══════════════════════════════════════════════════════════════
// 同步支持
// ═══════════════════════════════════════════════════════════════

export interface SyncableFileInfo {
  /** 系统级全路径 */
  path: string;
  nodeId: string;
  type: 'file' | 'directory';
  modifiedAt: number;
  moduleName: string;
}

// ═══════════════════════════════════════════════════════════════
// 导入导出
// ═══════════════════════════════════════════════════════════════

export interface ModuleExportData {
  version: number;
  moduleName: string;
  exportedAt: number;
  nodes: FSNode[];
  contents: Record<string, string>;
  moduleMetadata?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// 跨模块搜索
// ═══════════════════════════════════════════════════════════════

export interface VFSSearchQuery extends FSSearchQuery {
  /** 搜索范围：undefined 搜所有，string[] 搜指定模块 */
  modules?: string[];
}

// ═══════════════════════════════════════════════════════════════
// 系统统计
// ═══════════════════════════════════════════════════════════════

export interface VFSSystemStats {
  moduleCount: number;
  modules: Record<string, FSModuleStats>;
  totalFiles: number;
  totalSize: number;
  mountCount: number;
  storageBackends: Array<{
    mountId: string;
    mountPath: string;
    label?: string;
    backendName: string;
  }>;
  availableSpace?: number;
}

// ═══════════════════════════════════════════════════════════════
// 核心接口
// ═══════════════════════════════════════════════════════════════

export interface IVFSManager {

  // ==================== 生命周期 ====================

  /**
   * 初始化 VFS
   *
   * 1. 初始化 root 后端
   * 2. 确保基础目录结构（/etc, /dev, /module）
   * 3. 恢复持久化挂载点
   * 4. 注册内置设备驱动
   * 5. 初始化插件
   * 6. 挂载配置模块（__config）
   * 7. 挂载用户模块
   * 8. 启动同步服务（如已配置）
   */
  initialize(): Promise<void>;

  /**
   * 关闭 VFS
   *
   * 按逆序销毁：sync → plugins → devices → modules → unmount → backends
   */
  shutdown(): Promise<void>;

  // ==================== 挂载管理 ====================

  /** 获取挂载路由器（高级用法） */
  readonly mountRouter: IMountRouter;

  /**
   * 挂载存储后端到指定路径
   * @emits mount:added
   */
  mountBackend(
    mountPath: string,
    backend: IStorageBackend,
    options?: MountOptions,
  ): Promise<MountPoint>;

  /**
   * 卸载存储后端
   *
   * @param force 是否强制（忽略活跃操作）
   * @throws FSError('EINVAL') 不可卸载根挂载 "/"
   * @throws FSError('EBUSY') 有活跃操作且 force=false
   * @emits mount:removed
   */
  unmountBackend(mountPath: string, force?: boolean): Promise<void>;

  /** 列出所有挂载点 */
  listMounts(): MountPoint[];

  /** 获取路径所在的挂载点 */
  getMountForPath(absolutePath: string): MountPoint;

  // ==================== 模块管理 ====================

  /** 挂载模块（幂等） */
  mount(moduleName: string, options?: ModuleMountOptions): Promise<void>;

  /** 批量挂载 */
  mountAll(modules: Array<{ name: string; options?: ModuleMountOptions }>): Promise<void>;

  /**
   * 卸载模块
   * @param removeData 是否同时删除数据
   */
  unmount(moduleName: string, removeData?: boolean): Promise<void>;

  /** 获取模块信息 */
  getModule(moduleName: string): ModuleInfo | null;

  /** 获取所有已挂载模块 */
  getAllModules(): ModuleInfo[];

  // ==================== 引擎管理 ====================

  /**
   * 获取模块的 IModuleFS 实例（单例缓存）
   * @throws FSModuleNotFoundError
   */
  getEngine(moduleName: string): IModuleFS;

  /** 注册自定义引擎实现 */
  registerEngine(moduleName: string, engine: IModuleFS): void;

  // ==================== 跨模块便捷操作 ====================

  /**
   * 读取文件内容
   * @throws FSNotFoundError
   */
  read(moduleName: string, path: string): Promise<FileContent>;

  /** 写入文件内容（upsert 语义：不存在则创建，含中间目录） */
  write(moduleName: string, path: string, content: FileContent): Promise<void>;

  /** 检查路径是否存在 */
  exists(moduleName: string, path: string): Promise<boolean>;

  // ==================== 系统级路径操作 ====================

  /**
   * 通过系统级全路径读取（绕过 chroot 隔离）
   *
   * 路径格式：
   *   /module/{moduleName}/relative/path  → 业务模块文件
   *   /__config/app.conf                  → 配置文件
   *   /dev/llm                            → 设备文件
   *   /etc/system.conf                    → 系统配置
   */
  readBySystemPath(systemPath: string): Promise<FileContent>;

  /**
   * 通过全局节点 ID 获取节点（不限模块）
   * 用于跨模块引用、链接跳转。
   */
  getNodeById(nodeId: string): Promise<(FSNode & { moduleName: string }) | null>;

  // ==================== 跨模块搜索 ====================

  /** 跨模块搜索，分发到各模块的 search()，合并结果 */
  search(query: VFSSearchQuery): Promise<FSNode[]>;

  // ==================== 全局标签 ====================

  /** 汇总所有模块标签 */
  getAllTags(): Promise<GlobalTagInfo[]>;

  /** 更新全局标签定义 */
  updateTagDefinition(tagName: string, updates: { color?: string }): Promise<void>;

  /** 按标签查找节点 ID（跨模块） */
  findByTag(tagName: string): Promise<string[]>;

  // ==================== 同步 ====================

  /** 获取同步服务实例（未配置同步时返回 null） */
  getSyncService(): ISyncService | null;

  /** 索引所有可同步文件 */
  indexAllFiles(excludeModules?: string[]): Promise<SyncableFileInfo[]>;

  /** 流式遍历所有可同步文件（大数据量场景） */
  walkAllFiles?(
    callback: (file: SyncableFileInfo) => boolean | void,
    excludeModules?: string[],
  ): Promise<number>;

  // ==================== 备份与导入导出 ====================

  /** 全量备份（返回序列化后的 JSON 字符串） */
  createBackup(): Promise<string>;

  /** 恢复备份 ⚠️ 覆盖所有数据 */
  restoreBackup(jsonContent: string): Promise<void>;

  /** 导出模块（类型化返回） */
  exportModule(moduleName: string): Promise<ModuleExportData>;

  /** 导入模块 */
  importModule(data: ModuleExportData): Promise<void>;

  // ==================== 统计与维护 ====================

  /** 获取系统统计 */
  getSystemStats?(): Promise<VFSSystemStats>;

  /** 垃圾回收：清理孤儿 inode、无主 content、断裂引用 */
  gc?(): Promise<{ cleaned: number; freedBytes: number }>;

  /** 文件系统完整性检查 */
  fsck?(): Promise<{
    ok: boolean;
    errors: Array<{
      path: string;
      issue: string;
      severity: 'warning' | 'error';
    }>;
  }>;

  // ==================== 事件 ====================

  on<E extends VFSManagerEventType>(
    eventType: E,
    handler: (event: VFSManagerEvent<E>) => void,
  ): () => void;

  onAny(
    handler: (type: string, event: VFSManagerEvent) => void,
  ): () => void;

  // ==================== 插件 ====================

  /** 获取插件实例（按 ID） */
  getPlugin<T>(pluginId: string): T | null;

  /** 注册插件 */
  registerPlugin(plugin: IPlugin): Promise<void>;

  /** 注销插件 */
  unregisterPlugin(pluginId: string): Promise<void>;

  /** 列出已注册插件 */
  listPlugins(): PluginInfo[];
}
```

---

```typescript
/**
 * @file common/interfaces/fs/services/factory.ts
 * @desc VFS 工厂 — 面向不同运行环境提供统一的 VFS 实例创建方式
 *
 * 使用示例：
 *   const { manager, config } = await createVFS({
 *     rootBackend: new SQLiteBackend({ path: './data.db' }),
 *     modules: [{ name: 'notes' }, { name: 'tasks' }],
 *     devices: [randomDevice, llmDevice],
 *   });
 */

import type { IVFSManager, ModuleMountOptions } from './vfs-manager';
import type { IConfigService } from './config-service';
import type { IStorageBackend } from '../storage/backend';
import type { IDeviceDriver } from '../device/device';
import type { IPlugin } from '../plugin/plugin';
import type { MountOptions } from '../mount/mount';

// ═══════════════════════════════════════════════════════════════
// 工厂配置
// ═══════════════════════════════════════════════════════════════

export interface VFSFactoryOptions {
  /**
   * 根存储后端（挂载到 "/"）
   * 所有未被其他挂载点覆盖的路径都路由到此后端。
   */
  rootBackend: IStorageBackend;

  /**
   * 额外挂载点（可选）
   * 初始化时自动挂载到指定路径。
   */
  additionalMounts?: Array<{
    mountPath: string;
    backend: IStorageBackend;
    options?: MountOptions;
  }>;

  /**
   * 初始化时挂载的模块列表
   * __config 模块始终自动挂载。
   */
  modules?: Array<{
    name: string;
    options?: ModuleMountOptions;
  }>;

  /** 内置设备驱动 */
  devices?: IDeviceDriver[];

  /** 内置插件 */
  plugins?: IPlugin[];

  /** 初始配置（仅首次创建时写入，已有数据不覆盖） */
  initialConfigs?: Record<string, Record<string, string>>;

  /**
   * 符号链接解析最大深度
   * @default 40
   */
  maxSymlinkDepth?: number;

  /**
   * 是否启用事件合并（事务内）
   * @default true
   */
  coalesceTransactionEvents?: boolean;

  /**
   * 文件名验证正则
   * @default /^[^._/\\][^/\\]*$/
   */
  filenamePattern?: RegExp;
}

// ── 平台特定选项 ──

export interface BrowserVFSOptions extends VFSFactoryOptions {
  /** @default 'indexeddb' */
  storageAdapter?: 'indexeddb' | 'opfs';
  dbName?: string;
  dbVersion?: number;
}

export interface ElectronVFSOptions extends VFSFactoryOptions {
  /** 数据根目录 */
  rootDir: string;
  /** 是否启用文件监听 */
  enableWatch?: boolean;
}

export interface ServerVFSOptions extends VFSFactoryOptions {
  /** 数据库连接字符串 */
  databaseUrl?: string;
}

// ═══════════════════════════════════════════════════════════════
// 工厂返回值
// ═══════════════════════════════════════════════════════════════

/**
 * 分离返回 VFSManager + ConfigService
 * 消费方按需注入 DI 容器，避免紧耦合。
 */
export interface VFSInstance {
  manager: IVFSManager;
  config: IConfigService;
}

// ═══════════════════════════════════════════════════════════════
// 工厂函数签名
// ═══════════════════════════════════════════════════════════════

/**
 * 创建 VFS 的便捷函数类型
 *
 * 各平台导出各自的实现：
 * - electron: createVFS({ rootBackend: new SQLiteBackend(...) })
 * - browser:  createVFS({ rootBackend: new IndexedDBBackend(...) })
 * - server:   createVFS({ rootBackend: new PostgresBackend(...) })
 */
export type CreateVFSFn<T extends VFSFactoryOptions = VFSFactoryOptions> = (
  options: T,
) => Promise<VFSInstance>;
```

---

```typescript
/**
 * @file common/interfaces/fs/index.ts
 * @desc VFS 接口统一导出
 *
 * 使用方式：
 *   import type { IModuleFS, FSNode, FSFileNode } from '@common/interfaces/fs';
 *   import { FSError, FSNotFoundError } from '@common/interfaces/fs';
 */

// ── 常量 ──
export {
  CONFIG_MODULE,
  SYSTEM_DIRS,
  MOUNT_REGISTRY_PATH,
  ORPHAN_LOG_PATH,
  HIDDEN_PREFIX,
  ASSET_DIR_PREFIX,
  DEFAULT_MAX_SYMLINK_DEPTH,
  DEFAULT_FILENAME_PATTERN,
} from './constants';

// ── 核心类型 ──
export type {
  FSNodeType,
  FSNodeBaseType,
  FSNodeExtendedType,
  FSNode,
  FSFileNode,
  FSDirectoryNode,
  FSSeqFileNode,
  FSDeviceNode,
  FSSymlinkNode,
  FSNodeMetadata,
  SeqFileEntry,
  DirEntry,
  FileContent,
  FSSearchQuery,
  FSCapabilities,
  FSModuleStats,
} from './core/types';

// ── 错误 ──
export type { FSErrorCode } from './core/errors';
export {
  FSError,
  FSNotFoundError,
  FSAlreadyExistsError,
  FSAccessDeniedError,
  FSReadOnlyError,
  FSReservedNameError,
  FSConflictError,
  FSCapabilityError,
  FSModuleNotFoundError,
  FSSymlinkLoopError,
  FSCrossMountError,
  FSInvalidPathError,
} from './core/errors';

// ── 选项 ──
export type {
  ReadOptions,
  WriteOptions,
  CreateFileOptions,
  CreateDirectoryOptions,
  DeleteOptions,
  RenameOptions,
  MoveOptions,
  CopyOptions,
  ListOptions,
  TreeWalkOptions,
  TreeWalkCallback,
  WatchOptions,
} from './core/options';

// ── 事件 ──
export type {
  FSEventType,
  FSEvent,
  FSNodeCreatedPayload,
  FSNodeUpdatedPayload,
  FSNodeDeletedPayload,
  FSNodeMovedPayload,
  FSNodeCopiedPayload,
  FSNodeRenamedPayload,
  FSMountPayload,
  FSErrorPayload,
  FSEventPayloadMap,
  FSEventEmitter,
} from './core/events';

// ── 存储后端 ──
export type {
  StorageInode,
  StorageDirEntry,
  IInodeStore,
  IMetaStore,
  IContentStore,
  RecordValue,
  QueryOperator,
  RecordQuery,
  RecordQueryOptions,
  RecordQueryResult,
  IRecordStore,
  IHighLevelStore,
  ISyncableStore,
  BackendFeatures,
  BackendDescriptor,
  IStorageBackend,
  IRecordBackend,
  IHighLevelBackend,
  ISyncableBackend,
} from './storage';
export {
  isRecordBackend,
  isHighLevelBackend,
  isSyncableBackend,
} from './storage';

// ── 能力子接口 ──
export type { ISeqFileOperations } from './capabilities/seq-file';
export type { IAssetOperations } from './capabilities/asset-ops';
export type { TagDefinition, ITagOperations } from './capabilities/tag-ops';
export type { RefType, Reference, RefQueryOptions, IRefOperations } from './capabilities/ref-ops';
export type { FileChangeEvent, Watcher, IWatchable } from './capabilities/watch';

// ── 设备 ──
export type { DeviceContext, IDeviceDriver, IDeviceManager } from './device/device';

// ── 插件 ──
export type {
  OperationContext,
  MiddlewareNext,
  MiddlewareHandler,
  PluginInfo,
  IPlugin,
  IPluginManager,
} from './plugin/plugin';

// ── 挂载 ──
export type {
  MountPoint,
  MountOptions,
  MountSyncConfig,
  ResolvedMount,
  MountEventType,
  MountEvent,
  IMountRouter,
  MountRecord,
  IBackendFactory,
} from './mount/mount';

// ── 同步 ──
export type {
  SyncChangeEntry,
  SyncStatus,
  SyncProgress,
  SyncConflict,
  SyncConflictResolution,
  SyncResult,
  SyncOptions,
  ISyncAdapter,
  ISyncService,
} from './sync/sync';

// ── 模块文件系统 ──
export type { IFSTransaction, IModuleFS } from './services/module-fs';

// ── 配置服务 ──
export type {
  ConfigFileDescriptor,
  ConfigChangeEvent,
  IConfigService,
} from './services/config-service';

// ── VFS 管理器 ──
export type {
  ModuleInfo,
  ModuleMountOptions,
  VFSManagerEventType,
  VFSManagerEvent,
  VFSManagerEventPayloadMap,
  GlobalTagInfo,
  SyncableFileInfo,
  ModuleExportData,
  VFSSearchQuery,
  VFSSystemStats,
  IVFSManager,
} from './services/vfs-manager';

// ── 工厂 ──
export type {
  VFSFactoryOptions,
  BrowserVFSOptions,
  ElectronVFSOptions,
  ServerVFSOptions,
  VFSInstance,
  CreateVFSFn,
} from './services/factory';
```