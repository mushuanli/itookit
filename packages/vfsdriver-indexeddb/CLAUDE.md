# CLAUDE.md — @itookit/vfsdriver-indexeddb

浏览器 IndexedDB 存储后端。实现 v4.1 path-based `IStorageBackend`。

## Architecture (v4.1)

```
src/
├── index.ts           ← 公共 API — 导出 IndexedDBBackend
├── idb-backend.ts     ← IndexedDBBackend — IStorageBackend 实现 (单 store)
├── record-store.ts    ← IDBRecordStore — IRecordStore (K-V 查询)
└── utils.ts           ← IDB 工具函数 (openDB/req/collectCursor/deleteCursor)
```

## IndexedDBBackend

单 object store 模型（`nodes`），path 做主键：

| Store | Key Path | 存储内容 |
|---|---|---|
| `nodes` | `path` (string) | 文件/目录节点（含 content/tags/metadata） |
| `tags` | `id` (autoIncrement) | tag 反查索引 (tag + path) |
| `records` | `[ino, field]` | SeqFile K-V 记录（可选） |

数据库名称：`MindOS-v4`。

### 使用方式

```typescript
import { IndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { createVFS } from '@itookit/vfslib';

const backend = new IndexedDBBackend({ dbName: 'my-app-vfs' });
const { manager } = await createVFS({ rootBackend: backend, modules: [...] });
```

## 可选 Record Store

`IDBRecordStore` 实现 `IRecordStore`，提供泛型键值查询能力。通过 `LazyRecordStore` 包装器按需创建 IDB 事务。

## v4.1 变更

- 废弃 inode/meta/content 三层 object store → 单一 `nodes` store
- path (string) 替代 ino (number) 作为主键
- `ITransactionScope` → `transaction?(fn: (tx: IStorageBackend) => T)`

## 自动恢复（v4.1+）

- `openDB()` 失败时自动调用 `deleteDatabase` 重建数据库
- `write()` / `mkdir()` 自动通过 `_ensureParents()` 创建缺失的父目录
- `init()` 检查所有必需 store 是否存在，缺失时升级版本重建
- `verify()` 健康检查返回 `{ ok, errors, warnings }` — 检测孤儿 tag 和元数据不一致
- `repair(result)` 清理孤儿 tag，修复 sidecar 与主 store 的一致性
- 新增导出: `VerifyResult` 类型, `REQUIRED_STORES` 常量
