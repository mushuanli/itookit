
# @vfs-driver

一个可扩展的虚拟文件系统（VFS），支持多后端存储、插件中间件、虚拟设备和结构化记录文件。适用于浏览器（IndexedDB）、Node.js 和纯内存环境。

## 特性

- **多后端存储** — Memory、IndexedDB、Node.js 文件系统，可自定义扩展
- **POSIX 风格 API** — `create`、`read`、`write`、`mkdir`、`readdir`、`stat`、`unlink` 等
- **记录文件（Record File）** — 结构化 key-value 文件，支持字段级读写、索引和查询
- **插件中间件** — 拦截和修改文件操作（日志、权限控制、数据变换等）
- **虚拟设备** — `/dev/null`、`/dev/zero`、`/dev/random`，可注册自定义设备
- **挂载系统** — 将不同后端挂载到任意路径
- **事务支持** — 原子性批量操作，失败自动回滚
- **文件监听** — Watch API，支持递归监听子目录变更
- **元数据扩展** — 每个文件/目录可附加 MIME 类型、标签等自定义元数据
- **TypeScript 优先** — 完整类型定义

## 快速开始

### 安装

```bash
npm install @vfs-driver
```

### 基本用法

```typescript
import { createFileSystem } from '@vfs-driver';

// 自动检测环境（浏览器使用 IndexedDB，Node.js 使用文件系统，默认内存）
const fs = await createFileSystem();

// 创建文件
await fs.create('/hello.txt', 'Hello World');

// 读取文件
const content = await fs.read('/hello.txt');
console.log(content); // "Hello World"

// 创建目录
await fs.mkdir('/docs/notes', { recursive: true });

// 写入子目录
await fs.create('/docs/notes/todo.md', '# TODO\n- Learn VFS');

// 列出目录
const entries = await fs.readdir('/docs/notes');
console.log(entries); // [{ name: 'todo.md', ino: 3 }]

// 关闭
await fs.close();
```

### 手动选择后端

```typescript
import { FileSystem } from '@vfs-driver';
import { MemoryBackend } from '@vfs-driver';

const backend = new MemoryBackend();
const fs = new FileSystem(backend);
await fs.init();

// 使用 fs...

await fs.close();
```

### 指定后端类型

```typescript
import { createFileSystem } from '@vfs-driver';

// 内存后端
const memFs = await createFileSystem({ backend: 'memory' });

// IndexedDB 后端（浏览器）
const idbFs = await createFileSystem({
  backend: 'indexeddb',
  backendConfig: { dbName: 'my-app-fs' },
});

// Node.js 文件系统后端
const nodeFs = await createFileSystem({
  backend: 'node-fs',
  backendConfig: { rootPath: '/tmp/my-vfs' },
});
```

## API 参考

### 文件操作

```typescript
// 创建文件
await fs.create('/file.txt', 'content', { overwrite: false, metadata: { mimeType: 'text/plain' } });

// 读取文件（默认 utf-8 字符串）
const text = await fs.read('/file.txt');

// 读取二进制
const buffer = await fs.read('/image.png', { encoding: null });

// 写入（文件不存在时默认自动创建）
await fs.write('/file.txt', 'new content');
await fs.write('/file.txt', 'data', { create: false }); // 不自动创建

// 追加
await fs.append('/log.txt', 'new line\n');

// 删除文件
await fs.unlink('/file.txt');

// 重命名 / 移动
await fs.rename('/old.txt', '/new.txt');
await fs.rename('/src/file.txt', '/dst/file.txt');

// 复制
await fs.copy('/source.txt', '/target.txt', { overwrite: true });

// 检查是否存在
const exists = await fs.exists('/file.txt');

// 获取文件信息
const stat = await fs.stat('/file.txt');
console.log(stat.type);       // 'regular'
console.log(stat.size);       // 12
console.log(stat.isFile());   // true
console.log(stat.createdAt);  // 1700000000000
```

### 目录操作

```typescript
// 创建目录
await fs.mkdir('/mydir');

// 递归创建
await fs.mkdir('/a/b/c/d', { recursive: true });

// 列出内容
const entries = await fs.readdir('/mydir');
// [{ name: 'file.txt', ino: 5 }, { name: 'subdir', ino: 6 }]

// 删除空目录
await fs.rmdir('/empty-dir');

// 递归删除（含子文件和子目录）
await fs.rmdir('/project', { recursive: true });

// 强制删除（不存在时不报错）
await fs.rmdir('/maybe-exists', { force: true });
```

### 元数据

```typescript
// 创建时设置元数据
await fs.create('/photo.jpg', imageBuffer, {
  metadata: { mimeType: 'image/jpeg', tags: ['vacation', '2024'] },
});

// 读取元数据
const meta = await fs.getMetadata('/photo.jpg');
console.log(meta.mimeType); // 'image/jpeg'
console.log(meta.tags);     // ['vacation', '2024']

// 更新元数据（合并，不覆盖未指定的字段）
await fs.setMetadata('/photo.jpg', { tags: ['vacation', '2024', 'beach'] });
```

### 记录文件（Record File）

记录文件是一种结构化文件类型，内容为 key-value 对。每个字段可独立读写，value 支持所有 JSON 可序列化类型。在 IndexedDB 后端上可利用原生索引实现高效查询。

#### 创建

```typescript
// 创建空记录文件
await fs.createRecord('/config.rec');

// 带初始字段
await fs.createRecord('/settings.rec', {
  theme: 'dark',
  fontSize: 14,
  sidebar: { visible: true, width: 250 },
  recentFiles: ['/doc1.md', '/doc2.md'],
});

// 带索引（提高查询效率）
await fs.createRecord('/users.rec', {
  user1: { name: 'Alice', age: 30, role: 'admin' },
  user2: { name: 'Bob', age: 25, role: 'user' },
  user3: { name: 'Charlie', age: 35, role: 'admin' },
}, {
  indexes: ['role', 'age'],
  metadata: { mimeType: 'application/x-record' },
});
```

#### 字段读写

```typescript
// 读取单个字段
const theme = await fs.getField('/settings.rec', 'theme');
console.log(theme); // 'dark'

// 设置单个字段（不存在则创建，已存在则覆盖）
await fs.setField('/settings.rec', 'fontSize', 16);

// 删除单个字段
await fs.deleteField('/settings.rec', 'recentFiles');

// 读取所有字段
const all = await fs.getAllFields('/settings.rec');
console.log(all);
// { theme: 'dark', fontSize: 16, sidebar: { visible: true, width: 250 } }

// 批量覆盖所有字段
await fs.setAllFields('/settings.rec', {
  theme: 'light',
  fontSize: 12,
});

// 列出所有字段名
const fields = await fs.listFields('/settings.rec');
console.log(fields); // ['theme', 'fontSize']
```

#### 支持的值类型

```typescript
await fs.setField('/types.rec', 'string', 'hello');
await fs.setField('/types.rec', 'number', 42);
await fs.setField('/types.rec', 'float', 3.14);
await fs.setField('/types.rec', 'boolean', true);
await fs.setField('/types.rec', 'null', null);
await fs.setField('/types.rec', 'array', [1, 'two', true]);
await fs.setField('/types.rec', 'object', {
  nested: { deep: { value: 'found' } },
});
```

#### 查询

查询可以按字段值过滤记录文件中的条目。当 value 是对象时，查询条件中的 `field` 指定对象内的属性名（支持 `a.b.c` 点号路径）。

```typescript
// 等值查询
const admins = await fs.queryFields('/users.rec', {
  field: 'role',
  operator: '=',
  value: 'admin',
});
// [
//   { field: 'user1', value: { name: 'Alice', age: 30, role: 'admin' } },
//   { field: 'user3', value: { name: 'Charlie', age: 35, role: 'admin' } },
// ]

// 范围查询
const older = await fs.queryFields('/users.rec', {
  field: 'age',
  operator: '>=',
  value: 30,
});

// IN 查询
const selected = await fs.queryFields('/users.rec', {
  field: 'age',
  operator: 'in',
  value: [25, 35],
});

// 分页
const page2 = await fs.queryFields('/users.rec',
  { field: 'role', operator: '=', value: 'admin' },
  { offset: 10, limit: 10 },
);
```
**支持的查询操作符：**

| 操作符 | 说明 | 示例 |
|--------|------|------|
| `=` | 等于（深度比较） | `{ field: 'role', operator: '=', value: 'admin' }` |
| `!=` | 不等于 | `{ field: 'status', operator: '!=', value: 'deleted' }` |
| `<` | 小于（仅数值） | `{ field: 'age', operator: '<', value: 30 }` |
| `>` | 大于（仅数值） | `{ field: 'score', operator: '>', value: 90 }` |
| `<=` | 小于等于 | `{ field: 'price', operator: '<=', value: 100 }` |
| `>=` | 大于等于 | `{ field: 'priority', operator: '>=', value: 5 }` |
| `in` | 在列表中 | `{ field: 'type', operator: 'in', value: ['A', 'B'] }` |
| `contains` | 数组包含 | `{ field: 'tags', operator: 'contains', value: 'urgent' }` |

#### 索引管理

索引可加速查询。在支持 `RecordBackend` 的后端（如 MemoryBackend、IndexedDBBackend）上会创建真正的索引结构；在退化后端上仅记录索引元数据。

```typescript
// 创建时指定索引
await fs.createRecord('/products.rec', data, {
  indexes: ['category', 'price

// 运行时添加索引
await fs.createIndex('/products.rec', 'brand');

// 删除索引
await fs.deleteIndex('/products.rec', 'brand');

// 查看当前索引
const stat = await fs.stat('/products.rec');
console.log(stat.recordIndexes); // ['category', 'price']
```

#### 与常规操作的交互

记录文件参与文件系统的所有常规操作：

```typescript
// stat 显示 RECORD 类型
const stat = await fs.stat('/config.rec');
stat.isRecord();    // true
stat.isFile();      // false
stat.size;          // 字段数量

// exists
await fs.exists('/config.rec'); // true

// 出现在 readdir 中
const entries = await fs.readdir('/');
// [{ name: 'config.rec', ino: 5 }, ...]

// rename 保留所有字段和索引
await fs.rename('/config.rec', '/settings.rec');
await fs.getField('/settings.rec', 'theme'); // 仍可访问

// copy 创建独立副本
await fs.copy('/settings.rec', '/backup.rec');

// unlink 清理所有数据
await fs.unlink('/backup.rec');

// rmdir recursive 会清理目录内的记录文件
await fs.rmdir('/data', { recursive: true });

// 元数据与普通文件相同
await fs.setMetadata('/settings.rec', { description: 'App settings' });

// ⚠️ read/write/append 对记录文件会抛出 ENOTRECORD
await fs.read('/config.rec');  // throws ENOTRECORD
await fs.write('/config.rec', 'data'); // throws ENOTRECORD
```

#### 实际场景示例

**应用配置管理：**

```typescript
// 创建配置文件
await fs.createRecord('/app/config.rec', {
  database: { host: 'localhost', port: 5432, name: 'mydb' },
  cache: { ttl: 3600, maxSize: 1000 },
  logging: { level: 'info', file: '/var/log/app.log' },
});

// 仅修改某个配置项，无需读写整个文件
await fs.setField('/app/config.rec', 'logging', {
  level: 'debug',
  file: '/var/log/app.log',
  verbose: true,
});

// 读取单个配置
const dbConfig = await fs.getField('/app/config.rec', 'database');
```

**用户数据存储：**

```typescript
// 创建用户表并建立索引
await fs.createRecord('/data/users.rec', {}, {
  indexes: ['email', 'role', 'createdAt'],
});

// 添加用户
await fs.setField('/data/users.rec', 'user_001', {
  email: 'alice@example.com',
  name: 'Alice',
  role: 'admin',
  createdAt: Date.now(),
});

await fs.setField('/data/users.rec', 'user_002', {
  email: 'bob@example.com',
  name: 'Bob',
  role: 'user',
  createdAt: Date.now(),
});

// 查找所有管理员
const admins = await fs.queryFields('/data/users.rec', {
  field: 'role',
  operator: '=',
  value: 'admin',
});

// 分页获取用户
const page = await fs.queryFields('/data/users.rec',
  { field: 'createdAt', operator: '>', value: 0 },
  { offset: 0, limit: 20 },
);

// 事务中更新多个字段
await fs.transaction(async (tx) => {
  await tx.setField('/data/users.rec', 'user_001', {
    ...await tx.getField('/data/users.rec', 'user_001') as object,
    lastLogin: Date.now(),
  });
  await tx.setField('/data/users.rec', 'stats', {
    totalLogins: ((await tx.getField('/data/users.rec', 'stats') as any)?.totalLogins ?? 0) + 1,
  });
});
```

**键值缓存：**

```typescript
// 简单的 key-value 缓存
await fs.createRecord('/cache/api.rec');

// 缓存 API 响应
await fs.setField('/cache/api.rec', '/api/users', {
  data: [{ id: 1, name: 'Alice' }],
  cachedAt: Date.now(),
  ttl: 60000,
});

// 读取缓存
const cached = await fs.getField('/cache/api.rec', '/api/users') as any;
if (cached && Date.now() - cached.cachedAt < cached.ttl) {
  console.log('Cache hit:', cached.data);
} else {
  console.log('Cache miss');
  await fs.deleteField('/cache/api.rec', '/api/users');
}
```

### 事务

事务保证原子性——要么全部成功，要么全部回滚。

```typescript
// 成功：所有操作一起提交
await fs.transaction(async (tx) => {
  await tx.create('/accounts/alice.json', '{"balance": 100}');
  await tx.create('/accounts/bob.json', '{"balance": 200}');
  await tx.mkdir('/logs');
  await tx.create('/logs/init.log', 'System initialized');
});

// 失败：所有操作自动回滚
try {
  await fs.transaction(async (tx) => {
    await tx.write('/accounts/alice.json', '{"balance": 50}');
    await tx.write('/accounts/bob.json', '{"balance": 250}');
    throw new Error('Transfer validation failed');
  });
} catch (err) {
  // alice 和 bob 的余额保持原样
}

// 返回值
const total = await fs.transaction(async (tx) => {
  const alice = JSON.parse(await tx.read('/accounts/alice.json') as string);
  const bob = JSON.parse(await tx.read('/accounts/bob.json') as string);
  return alice.balance + bob.balance;
});
```

### 文件监听（Watch）

```typescript
// 监听目录下的直接子节点变更
const watcher = fs.watch('/', (event) => {
  console.log(event.type);      // 'create' | 'modify' | 'delete' | 'rename' | 'metadata'
  console.log(event.path);      // '/file.txt'
  console.log(event.timestamp); // 1700000000000
});

// 递归监听（含子目录）
const deepWatcher = fs.watch('/project', (event) => {
  console.log(`${event.type}: ${event.path}`);
}, { recursive: true });

// 监听重命名事件
fs.watch('/', (event) => {
  if (event.type === 'rename') {
    console.log(`Renamed from ${event.oldPath} to ${event.path}`);
  }
});

// 停止监听
watcher.close();
deepWatcher.close();
```

### 挂载

将不同存储后端挂载到文件系统树的任意路径。

```typescript
import { MemoryBackend } from '@vfs-driver';

// 创建主文件系统
const fs = await createFileSystem({ backend: 'memory' });

// 挂载额外的内存后端到 /tmp
const tmpBackend = new MemoryBackend();
await fs.mount('/tmp', tmpBackend);

// /tmp 下的操作使用 tmpBackend
await fs.create('/tmp/scratch.txt', 'temporary data');

// 根目录下的操作使用主后端
await fs.create('/home/data.txt', 'persistent data');

// 查看挂载列表
console.log(fs.mounts());
// [{ path: '/tmp', backendName: 'memory' }]

// 卸载
await fs.unmount('/tmp');
```

### 虚拟设备

```typescript
// 内置设备（通过 createFileSystem 自动注册，或手动注册）
import { nullDevice, zeroDevice, randomDevice } from '@vfs-driver';

fs.registerDevice(nullDevice);   // /dev/null
fs.registerDevice(zeroDevice);   // /dev/zero
fs.registerDevice(randomDevice); // /dev/random

// 读取设备
const empty = await fs.read('/dev/null', { encoding: null });   // 空 ArrayBuffer
const zeros = await fs.read('/dev/zero', { encoding: null });   // 全零 buffer
const random = await fs.read('/dev/random', { encoding: null }); // 随机 buffer

// 写入 /dev/null（数据被丢弃）
await fs.write('/dev/null', 'discarded');

// 列出设备
const devices = await fs.readdir('/dev');
// [{ name: 'null', ino: 0 }, { name: 'zero', ino: 0 }, { name: 'random', ino: 0 }]

// 设备状态
const stat = await fs.stat('/dev/null');
console.log(stat.isDevice()); // true
```

#### 自定义设备

```typescript
import type { DeviceDriver } from '@vfs-driver';

// 累加器设备
const counterDevice: DeviceDriver = {
  name: 'counter',
  state: { count: 0 },

  async read(size: number) {
    const text = String(this.state.count);
    return new TextEncoder().encode(text).buffer;
  },

  async write(data) {
    this.state.count++;
    return typeof data === 'string' ? data.length : data.byteLength;
  },

  async ioctl(command, arg) {
    switch (command) {
      case 'RESET':
        this.state.count = 0;
        return null;
      case 'GET_COUNT':
        return this.state.count;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  },
};

fs.registerDevice(counterDevice);

await fs.write('/dev/counter', 'tick');
await fs.write('/dev/counter', 'tick');
const count = await fs.ioctl('/dev/counter', 'GET_COUNT'); // 2
await fs.ioctl('/dev/counter', 'RESET');
```

### 插件系统

#### 中间件插件

中间件可拦截所有文件操作，实现日志、权限控制、数据变换等。

```typescript
import type { MiddlewarePlugin } from '@vfs-driver';

// 日志插件
const loggerPlugin: MiddlewarePlugin = {
  name: 'my-logger',
  version: '1.0.0',
  type: 'middleware',
  priority: 0, // 数字越小越先执行

  middleware() {
    return async (ctx, next) => {
      const start = Date.now();
      console.log(`[VFS] ${ctx.operation} ${ctx.path} ...`);
      await next();
      console.log(`[VFS] ${ctx.operation} ${ctx.path} OK (${Date.now() - start}ms)`);
    };
  },
};

await fs.use(loggerPlugin);
```

#### 只读保护插件

```typescript
const readonlyPlugin: MiddlewarePlugin = {
  name: 'readonly-guard',
  version: '1.0.0',
  type: 'middleware',
  priority: 1,

  middleware() {
    return async (ctx, next) => {
      const writeOps = ['create', 'write', 'append', 'unlink', 'rename', 'mkdir', 'rmdir'];
      if (writeOps.includes(ctx.operation) && ctx.path.startsWith('/system/')) {
        throw new FileSystemError('EACCES', ctx.path, 'Read-only area');
      }
      await next();
    };
  },
};
```

#### 内容变换插件

```typescript
const encryptPlugin: MiddlewarePlugin = {
  name: 'encrypt',
  version: '1.0.0',
  type: 'middleware',

  middleware() {
    return async (ctx, next) => {
      // 写入前加密
      if (ctx.operation === 'write' || ctx.operation === 'create') {
        if (ctx.args.content && typeof ctx.args.content === 'string') {
          ctx.args.content = encrypt(ctx.args.content);
        }
      }

      await next();

      // 读取后解密
      if (ctx.operation === 'read' && typeof ctx.result === 'string') {
        ctx.result = decrypt(ctx.result);
      }
    };
  },
};
```

#### 插件管理

```typescript
// 注册插件
await fs.use(myPlugin);

// 查看已注册插件
const plugins = fs.plugins.list();
// [{ name: 'my-logger', version: '1.0.0', type: 'middleware' }]

// 检查插件是否存在
fs.plugins.has('my-logger'); // true

// 获取插件实例
const plugin = fs.plugins.get<MiddlewarePlugin>('my-logger');

// 移除插件
await fs.plugins.remove('my-logger', fs);
```

#### 内置日志插件

```typescript
import { loggerPlugin } from '@vfs-driver';

await fs.use(loggerPlugin);
// 所有操作将输出 [VFS] create /file.txt OK (2ms) 格式的日志
```

## 自定义存储后端

### 基础后端

实现 `StorageBackend` 接口：

```typescript
import type { StorageBackend, Inode, DirEntry } from '@vfs-driver';

class MyCustomBackend implements StorageBackend {
  readonly name = 'my-backend';

  async init(): Promise<void> { /* 初始化存储 */ }
  async close(): Promise<void> { /* 清理资源 */ }

  // Inode CRUD
  async getInode(ino: number): Promise<Inode | null> { /* ... */ }
  async putInode(inode: Inode): Promise<void> { /* ... */ }
  async deleteInode(ino: number): Promise<void> { /* ... */ }
  async allocateIno(): Promise<number> { /* ... */ }

  // 数据块 CRUD
  async getData(ref: string): Promise<ArrayBuffer | null> { /* ... */ }
  async putData(ref: string, data: ArrayBuffer): Promise<void> { /* ... */ }
  async deleteData(ref: string): Promise<void> { /* ... */ }

  // 目录项 CRUD
  async getDirEntries(ino: number): Promise<DirEntry[]> { /* ... */ }
  async putDirEntry(parentIno: number, entry: DirEntry): Promise<void> { /* ... */ }
  async deleteDirEntry(parentIno: number, name: string): Promise<void> { /* ... */ }

  // 事务
  async runInTransaction<T>(
    mode: 'readonly' | 'readwrite',
    fn: (backend: StorageBackend) => Promise<T>,
  ): Promise<T> { /* ... */ }
}
```

可通过后端一致性测试验证实现的正确性：

```typescript
// tests/backend.conformance.test.ts
const backends = [
  { name: 'MyCustomBackend', create: () => new MyCustomBackend() },
  // ...
];
```

### 支持记录文件的后端

额外实现 `RecordBackend` 接口以获得字段级操作的原生支持。不实现此接口时，FileSystem 会自动退化为整体 JSON 读写。

```typescript
import type { RecordBackend, RecordValue, RecordQuery, RecordQueryResult } from '@vfs-driver';

class MyRecordBackend extends MyBackend implements RecordBackend {
  async getRecordField(ino: number, field: string): Promise<RecordValue | undefined> { /* ... */ }
  async setRecordField(ino: number, field: string, value: RecordValue): Promise<void> { /* ... */ }
  async deleteRecordField(ino: number, field: string): Promise<void> { /* ... */ }
  async getAllRecordFields(ino: number): Promise<Record<string, RecordValue>> { /* ... */ }
  async setAllRecordFields(ino: number, fields: Record<string, RecordValue>): Promise<void> { /* ... */ }
  async clearRecordFields(ino: number): Promise<void> { /* ... */ }
  async listRecordFields(ino: number): Promise<string[]> { /* ... */ }
  async createRecordIndex(ino: number, field: string): Promise<void> { /* ... */ }
  async deleteRecordIndex(ino: number, field: string): Promise<void> { /* ... */ }
  async queryRecordFields(
    ino: number,
    query: RecordQuery,
    options?: RecordQueryOptions,
  ): Promise<RecordQueryResult[]> { /* ... */ }
}
```

## 架构

```
┌────────────────────────────────────────────────────┐
│                    FileSystem                       │
│  ┌──────────┐ ┌──────────┐ ┌───────────────────┐  │
│  │ PathUtils │ │ WatchMgr │ │    MountTable     │  │
│  └──────────┘ └──────────┘ └───────────────────┘  │
│  ┌──────────────────────────────────────────────┐  │
│  │           MiddlewarePipeline                  │  │
│  │  plugin A → plugin B → core fn               │  │
│  └──────────────────────────────────────────────┘  │
│  ┌───────────────┐  ┌───────────────────────┐     │
│  │ DeviceManager  │  │    PluginManager      │     │
│  └───────────────┘  └───────────────────────┘     │
│  ┌──────────────────────────────────────────────┐  │
│  │          FallbackRecordOps                    │  │
│  │  (退化模式：后端不支持 RecordBackend 时使用)     │  │
│  └──────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────┤
│              StorageBackend / RecordBackend         │
│  ┌────────┐ ┌───────────┐ ┌────────────┐          │
│  │ Memory │ │ IndexedDB │ │  Node FS   │          │
│  │  (*)   │ │    (*)    │ │ (fallback) │          │
│  └────────┘ └───────────┘ └────────────┘          │
│  (*) = 实现 RecordBackend 接口                      │
└────────────────────────────────────────────────────┘
```

### 核心概念

| 概念 | 说明 |
|------|------|
| **Inode** | 文件/目录的元信息节点，包含类型、大小、时间戳、元数据等 |
| **DirEntry** | 目录项 `{ name, ino }`，将名称映射到 inode |
| **DataRef** | 数据块引用键，Inode 通过 `dataRef` 指向实际数据 |
| **FileType.RECORD** | 记录文件类型，内容为结构化 key-value |
| **RecordBackend** | 支持字段级操作的后端接口 |
| **FallbackRecordOps** | 后端不支持 RecordBackend 时的退化实现 |
| **StorageBackend** | 底层存储抽象，只负责 Inode/Data/DirEntry 的 CRUD |
| **PathResolver** | 将路径解析为 Inode，处理符号链接和 `..` 等 |
| **MiddlewarePipeline** | 洋葱模型中间件管道，按优先级排序执行 |
| **DeviceDriver** | 虚拟设备接口，提供 `read`/`write`/`ioctl` |

### 文件类型

| 类型 | 枚举值 | 说明 |
|------|--------|------|
| 常规文件 | `FileType.REGULAR` | 二进制/文本内容，通过 `read`/`write` 整体访问 |
| 目录 | `FileType.DIRECTORY` | 包含子项列表 |
| 记录文件 | `FileType.RECORD` | 结构化 key-value，通过 `getField`/`setField` 字段级访问 |
| 符号链接 | `FileType.SYMLINK` | 指向其他路径 |
| 设备 | `FileType.DEVICE` | 虚拟设备 |

### 数据流

```
用户调用 fs.read('/a/b/c.txt')
  │
  ▼
MiddlewarePipeline (插件拦截)
  │
  ▼
MountTable.resolve → 选择 Backend
  │
  ▼
PathResolver.resolve('/a/b/c.txt')
  │  根 inode(1) → getDirEntries(1) → find 'a'
  │  inode(a) → getDirEntries(a.ino) → find 'b'
  │  inode(b) → getDirEntries(b.ino) → find 'c.txt'
  ▼
Backend.getData(inode.dataRef)
  │
  ▼
返回内容 → 中间件后处理 → 用户
```

## 内置后端

| 后端 | 环境 | 持久化 | RecordBackend | 说明 |
|------|------|--------|---------------|------|
| `MemoryBackend` | 全平台 | ❌ | ✅ | 纯内存，适用于测试 |
| `IndexedDBBackend` | 浏览器 | ✅ | 可扩展 | 基于 IndexedDB |
| `NodeFSBackend` | Node.js | ✅ | ❌ (退化) | 映射到本地 `.vfs` 目录 |

## 错误处理

所有文件操作错误抛出 `FileSystemError`，包含标准 POSIX 错误码：

```typescript
import { FileSystemError } from '@vfs-driver';

try {
  await fs.read('/nonexistent.txt');
} catch (err) {
  if (err instanceof FileSystemError) {
    console.log(err.code);    // 'ENOENT'
    console.log(err.path);    // '/nonexistent.txt'
    console.log(err.message); // "ENOENT: No such file or directory '/nonexistent.txt'"
  }
}
```

| 错误码 | 含义 |
|--------|------|
| `ENOENT` | 文件或目录不存在 |
| `EEXIST` | 文件或目录已存在 |
| `EISDIR` | 目标是目录（不能当文件操作） |
| `ENOTDIR` | 目标不是目录（路径中间组件不是目录） |
| `ENOTEMPTY` | 目录非空（无法删除） |
| `EACCES` | 权限拒绝 |
| `ENOSPC` | 存储空间不足 |
| `ENOTTY` | 设备不支持 ioctl |
| `EINVAL` | 无效参数 |
| `ELOOP` | 符号链接层数过多 |
| `EIO` | I/O 错误 |
| `EPLUGIN` | 插件错误 |
| `ENOTRECORD` | 不是记录文件（对记录文件使用 `read`/`write`，或对普通文件使用 `getField`/`setField`） |

## 开发

### 运行测试

```bash
# 安装依赖
npm install

# 运行全部测试
npm test

# 运行带覆盖率的测试
npm run test:coverage

# 运行特定测试文件
npx vitest tests/record.test.ts
npx vitest tests/filesystem.test.ts
npx vitest tests/path.test.ts
npx vitest tests/plugin.test.ts
npx vitest tests/device.test.ts
npx vitest tests/transaction.test.ts
npx vitest tests/watch.test.ts
npx vitest tests/backend.conformance.test.ts
npx vitest tests/errors.test.ts
npx vitest tests/inode.test.ts
```

### 测试矩阵

| 测试文件 | 覆盖范围 |
|----------|----------|
| `backend.conformance.test.ts` | 后端接口一致性（Inode/Data/DirEntry CRUD + 事务） |
| `filesystem.test.ts` | 文件/目录操作、元数据、挂载、边界情况 |
| `record.test.ts` | 记录文件 CRUD、查询、索引、事务、中间件交互 |
| `path.test.ts` | 路径工具函数 + PathResolver |
| `plugin.test.ts` | 中间件拦截、优先级、状态共享、生命周期 |
| `device.test.ts` | 内置设备 + 自定义设备 + ioctl + DeviceManager |
| `transaction.test.ts` | 事务提交、回滚、读写隔离 |
| `watch.test.ts` | 文件监听、递归/非递归、watcher 生命周期 |
| `errors.test.ts` | FileSystemError 构造与错误码 |
| `inode.test.ts` | Inode 创建与 stat 转换 |

### 构建

```bash
npm run build
```

### 项目结构

```
vfs/
├── src/
│   ├── index.ts              # 公共导出（唯一出口）
│   ├── types.ts              # 所有类型定义
│   ├── core/
│   │   ├── filesystem.ts     # FileSystem 主类
│   │   ├── path.ts           # PathUtils + PathResolver
│   │   ├── inode.ts          # Inode 工具函数
│   │   └── errors.ts         # FileSystemError
│   ├── backend/
│   │   ├── interface.ts      # StorageBackend 接口
│   │   ├── memory.ts         # 内存后端
│   │   ├── indexeddb.ts      # IndexedDB 后端
│   │   └── node-fs.ts        # Node.js 文件系统后端
│   ├── plugin/
│   │   ├── manager.ts        # PluginManager
│   │   ├── middleware.ts      # MiddlewarePipeline
│   │   └── builtins.ts       # 内置插件
│   └── device/
│       ├── manager.ts        # DeviceManager
│       ├── interface.ts      # DeviceDriver 接口重导出
│       └── builtins.ts       # 内置设备
├── tests/
│   ├── backend.conformance.test.ts
│   ├── filesystem.test.ts
│   ├── record.test.ts        # ← 新增
│   ├── path.test.ts
│   ├── plugin.test.ts
│   ├── device.test.ts
│   ├── transaction.test.ts
│   ├── watch.test.ts
│   ├── errors.test.ts
│   └── inode.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

## 许可

MIT
```

---

**package.json 参考配置：**

```json
{
  "name": "@vfs-driver/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0"
  }
}
```

---

### 审查总结

| 类别 | 问题 | 修复 |
|------|------|------|
| **Bug** | `WatchManager.matches` 对非递归模式下的直接子节点（尤其是根 `/`）永远不匹配 | 重写匹配逻辑：区分精确匹配、直接子节点（始终匹配）、深层后代（仅递归） |
| **Bug** | `backend.conformance.test.ts` 最后一个测试用例截断 | 补全并扩展为完整的一致性测试套件 |
| **Dead Code** | `PathResolver.cache` 声明但从未使用 | 保留接口但标注为预留（不影响正确性） |
| **Dead Code** | `contentByteLength` 函数未使用 | 移除 |
| **Dead Code** | `PathResolver.resolve` 中 `isLast` 变量未使用 | 移除 |
| **覆盖率** | 缺少 `errors.ts` 和 `inode.ts` 的单元测试 | 新增 `errors.test.ts` 和 `inode.test.ts` |
| **覆盖率** | `PathResolver` 无独立测试 | 在 `path.test.ts` 中新增 `PathResolver` 测试 |
| **覆盖率** | `MiddlewarePipeline` 和 `PluginManager` 无独立单元测试 | 在 `plugin.test.ts` 中新增单元测试 |
| **覆盖率** | `DeviceManager` 无独立单元测试 | 在 `device.test.ts` 中新增单元测试 |
| **覆盖率** | 挂载系统无测试 | 在 `filesystem.test.ts` 中新增挂载测试 |
| **覆盖率** | Watch 系统缺少非递归直接子节点、根目录等边界测试 | 在 `watch.test.ts` 中大幅扩展 |
| **文档** | 缺少 README | 新增完整 README，含 API 参考、架构图、测试矩阵 |