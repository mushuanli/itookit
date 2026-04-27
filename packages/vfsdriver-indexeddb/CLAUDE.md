# CLAUDE.md — @itookit/vfsdriver-indexeddb

浏览器 IndexedDB 存储后端。实现 `IStorageBackend` 三层存储接口（inode + meta + content），可选扩展 `IRecordStore`。

## Commands

```bash
pnpm --filter @itookit/vfsdriver-indexeddb build       # tsup
pnpm --filter @itookit/vfsdriver-indexeddb dev         # tsup --watch
pnpm --filter @itookit/vfsdriver-indexeddb test        # vitest
pnpm --filter @itookit/vfsdriver-indexeddb test:watch  # vitest --watch
```

## Architecture

```
src/
├── index.ts           ← 公共 API — 导出 IndexedDBBackend
├── idb-backend.ts     ← IndexedDBBackend — IStorageBackend 实现
├── inode-store.ts     ← IndexedDBInodeStore
├── meta-store.ts      ← IndexedDBMetaStore
├── content-store.ts   ← IndexedDBContentStore
├── record-store.ts    ← IndexedDBRecordStore (可选)
└── utils.ts           ← IndexedDB 工具函数
```

## IndexedDBBackend

实现 `IStorageBackend` 接口。使用 IndexedDB 的 object stores 存储 VFS 的三种数据类型：

| Store | Key Path | 存储内容 |
|---|---|---|
| `inodes` | `id` (自增) | 文件/目录 inode 记录 |
| `meta` | `inodeId` | 节点元数据 |
| `content` | `inodeId` | 文件内容 (ArrayBuffer) |

数据库名称：`MindOS-v3`（旧版本 `MindOS-v2`、`MindOS` 不兼容）。

### 使用方式

```typescript
import { IndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { createVFS } from '@itookit/vfslib';

const backend = new IndexedDBBackend();
const { manager } = await createVFS({ rootBackend: backend, modules: [...] });
```

## 可选 Record Store

`IndexedDBRecordStore` 实现 `IRecordStore`，提供泛型键值查询能力，用于需要结构化查询的场景。

## Conventions

- 所有 IndexedDB 操作返回 Promise
- Transaction 使用 IndexedDB 原生 transaction 机制
- `content` store 存储 `ArrayBuffer`（二进制友好）
- DB 升级通过 `onupgradeneeded` 事件处理
