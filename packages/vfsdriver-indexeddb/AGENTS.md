# @itookit/vfsdriver-indexeddb

浏览器 IndexedDB 存储后端 — 实现 path-based `IStorageBackend`。

## 结构

```
src/
├── index.ts           公共 API — IndexedDBBackend / openIndexedDBBackend / IDBRecordStore / 常量
├── idb-backend.ts     IndexedDBBackend — IStorageBackend 实现 + LazyRecordStore
├── record-store.ts    IDBRecordStore — IRecordStore (K-V 查询)
└── utils.ts           IDB 工具 + store 名与版本常量 (openDB/req/collectCursor/txDone)
```

## object store 模型

数据库名默认 `MindOS-v4`(`IndexedDBBackendOptions.dbName` 可覆盖),`DB_VERSION = 3`:

| Store | Key Path | 存储内容 |
|---|---|---|
| `nodes` | `path` (string) | 文件/目录节点(含 content/tags/metadata) |
| `tags` | `id` (autoIncrement) | tag 反查索引(`{ path, tag }`,含 `tag` 索引) |
| `records` | `['path', 'field']` | SeqFile K-V 记录(`idx_path` 索引) |

三个 store 都在 `REQUIRED_STORES` 中,`init()` 时缺一即报错。

### 使用方式

```typescript
import { openIndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { createVFS } from '@itookit/vfs-core';

const backend = await openIndexedDBBackend({ dbName: 'my-app-vfs' });
const { manager } = await createVFS({ rootBackend: backend });
```

`createVFS()` 内部会调用根后端 `init()`,因此也可直接 `new IndexedDBBackend(options)` 传入。

## 关键约束

- 单一 `nodes` store 承载节点数据,path 为主键(不再有 inode/meta/content 分层)。
- `write()` / `mkdir()` 通过 `_ensureParents()` 自动补齐缺失父目录。
- `init()` 遇到旧版本或不兼容 schema 直接抛错(`Filesystem database version/schema incompatible`),**不会**自动删库重建;`VerifyResult.missingStores` 需要重建数据库处理。
- `verify()` 返回 `{ healthy, missingStores, orphanNodes, missingParents, orphanTags, totalNodes, totalTags }`;`repair()` 目前只清理孤儿 tag,返回 `{ fixedOrphanTags }`。
- 可选 Record Store:后端 `records` 属性是 `LazyRecordStore`(按需取 IDB 事务),内部委托 `IDBRecordStore`。

## 测试

```bash
pnpm --filter @itookit/vfsdriver-indexeddb test   # vitest run (fake-indexeddb)
```
