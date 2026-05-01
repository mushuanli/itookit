# @itookit/vfsdriver-fs

Node/Electron 本地文件系统 + SQLite 存储后端。实现 `IStorageBackend`。使用 `better-sqlite3` 存储 inode/meta，文件系统直接存储 content。

## Architecture

```
src/
├── index.ts            ← 公共 API
├── fs-backend.ts       ← LocalFSBackend — IStorageBackend 实现
├── db/
│   ├── connection.ts   ← SQLite 连接管理
│   ├── schema.ts       ← 数据库 schema 定义
│   └── migrations.ts   ← Schema 迁移
├── stores/
│   ├── fs-inode-store.ts    ← SQLite Inode 存储
│   ├── fs-meta-store.ts     ← SQLite Meta 存储
│   ├── fs-content-store.ts  ← 文件系统 Content 存储
│   └── fs-record-store.ts   ← SQLite Record 存储
└── utils/
    ├── atomic-write.ts ← 原子写入
    └── startup.ts      ← 启动初始化
```

## LocalFSBackend

实现 `IStorageBackend`。存储分层：

| 层 | 存储方式 | 说明 |
|---|---|---|
| Inode | SQLite 表 | 文件/目录 inode 记录 |
| Meta | SQLite 表 | 节点元数据 (JSON) |
| Content | 本地文件系统 | 文件内容直接写入磁盘 |
| Record | SQLite 表 (可选) | 结构化键值查询 |

### 使用方式

```typescript
import { LocalFSBackend } from '@itookit/vfsdriver-fs';
import { createVFS } from '@itookit/vfslib';

const backend = new LocalFSBackend({ dbPath: './vfs.db', contentDir: './vfs-content' });
const { manager } = await createVFS({ rootBackend: backend, modules: [...] });
```

## Schema 迁移

`db/migrations.ts` 管理 SQLite schema 版本升级，使用 `user_version` PRAGMA 跟踪版本号。

## Conventions

- Content 存储使用 `atomic-write` 确保写入完整性（先写临时文件再 rename）
- SQLite 连接由 `db/connection.ts` 管理
- 仅 Node/Electron 环境可用 — 浏览器使用 `@itookit/vfsdriver-indexeddb`
