# VFS 模块化重构与目录结构优化方案

## 一、重构后的目录结构

```
packages/
├── vfs-core/                     # 核心包（最小可用单元）
│   ├── src/
│   │   ├── index.ts              # 统一导出
│   │   │
│   │   ├── kernel/               # 内核层（不可裁剪）
│   │   │   ├── VFSKernel.ts      # 最小内核
│   │   │   ├── VNode.ts          # 节点数据结构
│   │   │   ├── PathResolver.ts   # 路径解析
│   │   │   ├── EventBus.ts       # 事件总线
│   │   │   └── types.ts          # 核心类型定义
│   │   │
│   │   ├── storage/              # 存储抽象层
│   │   │   ├── interfaces/
│   │   │   │   ├── IStorageAdapter.ts
│   │   │   │   ├── ITransaction.ts
│   │   │   │   └── ICollection.ts
│   │   │   ├── StorageManager.ts # 存储管理器
│   │   │   └── MemoryAdapter.ts  # 内置内存适配器（用于测试）
│   │   │
│   │   ├── plugin/               # 插件系统
│   │   │   ├── interfaces/
│   │   │   │   ├── IPlugin.ts
│   │   │   │   ├── IPluginContext.ts
│   │   │   │   └── ExtensionPoints.ts
│   │   │   ├── PluginManager.ts
│   │   │   ├── PluginContext.ts
│   │   │   └── PluginLoader.ts
│   │   │
│   │   ├── errors/               # 错误定义
│   │   │   ├── VFSError.ts
│   │   │   └── ErrorCodes.ts
│   │   │
│   │   └── utils/                # 工具函数
│   │       ├── id.ts
│   │       ├── path.ts
│   │       └── encoding.ts
│   │
│   ├── package.json
│   └── tsconfig.json
│
├── vfs-storage-indexeddb/        # IndexedDB 存储插件
│   ├── src/
│   │   ├── index.ts
│   │   ├── IndexedDBPlugin.ts
│   │   ├── IndexedDBAdapter.ts
│   │   └── IndexedDBTransaction.ts
│   └── package.json
│
├── vfs-storage-sqlite/           # SQLite 存储插件
│   ├── src/
│   │   ├── index.ts
│   │   ├── SQLitePlugin.ts
│   │   ├── SQLiteAdapter.ts
│   │   └── drivers/
│   │       ├── BetterSqlite3Driver.ts  # Node.js
│   │       ├── SqlJsDriver.ts          # Browser
│   │       └── TauriSqlDriver.ts       # Tauri
│   └── package.json
│
├── vfs-middleware/               # 中间件系统
│   ├── src/
│   │   ├── index.ts
│   │   ├── MiddlewarePlugin.ts
│   │   ├── MiddlewareRegistry.ts
│   │   ├── interfaces/
│   │   │   └── IMiddleware.ts
│   │   └── builtin/              # 内置中间件
│   │       ├── ValidationMiddleware.ts
│   │       └── CompositeMiddleware.ts
│   └── package.json
│
├── vfs-tags/                     # 标签系统插件
│   ├── src/
│   │   ├── index.ts
│   │   ├── TagsPlugin.ts
│   │   ├── TagManager.ts
│   │   ├── schemas.ts
│   │   └── types.ts
│   └── package.json
│
├── vfs-assets/                   # 资产管理插件
│   ├── src/
│   │   ├── index.ts
│   │   ├── AssetsPlugin.ts
│   │   ├── AssetManager.ts
│   │   └── AssetUtils.ts
│   └── package.json
│
├── vfs-srs/                      # SRS 间隔重复插件
│   ├── src/
│   │   ├── index.ts
│   │   ├── SRSPlugin.ts
│   │   ├── SRSManager.ts
│   │   ├── algorithms/
│   │   │   ├── SM2.ts
│   │   │   └── FSRS.ts
│   │   └── schemas.ts
│   └── package.json
│
├── vfs-sync/                     # 同步系统插件
│   ├── src/
│   │   ├── index.ts
│   │   ├── SyncPlugin.ts
│   │   ├── SyncEngine.ts
│   │   ├── interfaces/
│   │   │   └── ISyncAdapter.ts
│   │   ├── adapters/
│   │   │   ├── HttpSyncAdapter.ts
│   │   │   └── WebSocketSyncAdapter.ts
│   │   └── conflict/
│   │       ├── ConflictResolver.ts
│   │       └── strategies/
│   └── package.json
│
├── vfs-search/                   # 搜索插件
│   ├── src/
│   │   ├── index.ts
│   │   ├── SearchPlugin.ts
│   │   ├── SearchEngine.ts
│   │   └── providers/
│   │       ├── BasicSearchProvider.ts
│   │       └── FullTextSearchProvider.ts
│   └── package.json
│
├── vfs-modules/                  # 模块管理（高层封装）
│   ├── src/
│   │   ├── index.ts
│   │   ├── ModulesPlugin.ts
│   │   ├── ModuleManager.ts
│   │   └── types.ts
│   └── package.json
│
├── vfs-adapter-session/          # Session Engine 适配器
│   ├── src/
│   │   ├── index.ts
│   │   ├── VFSModuleEngine.ts
│   │   └── BaseModuleService.ts
│   └── package.json
│
└── vfs/                          # 完整预设包（全功能）
    ├── src/
    │   ├── index.ts              # 统一导出所有功能
    │   ├── presets/
    │   │   ├── browser.ts        # 浏览器预设
    │   │   ├── node.ts           # Node.js 预设
    │   │   ├── electron.ts       # Electron 预设
    │   │   └── minimal.ts        # 最小预设
    │   └── VFSFactory.ts         # 工厂函数
    └── package.json
```

---

## 五、使用示例

### 5.1 浏览器环境

```typescript
// 使用浏览器预设
import { createBrowserVFS } from '@vfs/vfs';

async function main() {
  // 创建 VFS 实例（包含所有功能）
  const vfsInstance = await createBrowserVFS({
    dbName: 'my_app_db',
    defaultModule: 'notes',
    enableTags: true,
    enableAssets: true
  });

  // 包装为高层 API
  const vfs = new VFS(vfsInstance);

  // 创建文件
  const file = await vfs.createFile('notes', '/hello.md', '# Hello World');
  console.log('Created file:', file);

  // 添加标签
  await vfs.addTag(file.nodeId, 'important');
  await vfs.addTag(file.nodeId, 'tutorial');

  // 创建资产
  const imageData = new ArrayBuffer(100); // 模拟图片数据
  await vfs.createAsset(file.nodeId, 'image.png', imageData);

  // 读取内容
  const content = await vfs.read('notes', '/hello.md');
  console.log('Content:', content);

  // 搜索
  const results = await vfs.findByTag('important');
  console.log('Found by tag:', results);

  // 关闭
  await vfs.shutdown();
}
```

### 5.2 最小化配置（测试用）

```typescript
import { createMinimalVFS, VFS } from '@vfs/vfs';

async function testVFS() {
  const instance = await createMinimalVFS();
  const vfs = new VFS(instance);

  // 基础操作
  await vfs.kernel.createNode({
    path: '/test.txt',
    type: VNodeType.FILE,
    content: 'Hello'
  });

  const content = await vfs.kernel.read(
    await vfs.kernel.resolvePathToId('/test.txt')!
  );
  console.log(content); // 'Hello'

  await vfs.shutdown();
}
```

### 5.3 自定义插件组合

```typescript
import { 
  createVFS, 
  VFS,
  IndexedDBStoragePlugin,
  MiddlewarePlugin,
  ModulesPlugin,
  TagsPlugin
} from '@vfs/vfs';
import { IMiddleware, BaseMiddleware } from '@vfs/middleware';

// 自定义中间件
class LoggingMiddleware extends BaseMiddleware {
  readonly name = 'logging';
  readonly priority = 100;

  async onBeforeWrite(node: any, content: any): Promise<any> {
    console.log(`[Write] ${node.path}`);
    return content;
  }

  async onAfterDelete(node: any): Promise<void> {
    console.log(`[Delete] ${node.path}`);
  }
}

async function customSetup() {
  const instance = await createVFS({
    storage: {
      type: 'indexeddb',
      config: { dbName: 'custom_db', version: 1 }
    },
    plugins: [
      new IndexedDBStoragePlugin(),
      new MiddlewarePlugin(),
      new ModulesPlugin(),
      new TagsPlugin()
      // 不加载 AssetsPlugin
    ]
  });

  const vfs = new VFS(instance);

  // 注册自定义中间件
  vfs.registerMiddleware(new LoggingMiddleware());

  // 使用
  await vfs.mount('app');
  await vfs.createFile('app', '/data.json', '{}');
  // 控制台输出: [Write] /app/data.json

  await vfs.shutdown();
}
```

### 5.4 业务服务示例

```typescript
import { BaseModuleService, VFS } from '@vfs/vfs';

interface UserSettings {
  theme: 'light' | 'dark';
  language: string;
  notifications: boolean;
}

class SettingsService extends BaseModuleService {
  private settings: UserSettings = {
    theme: 'light',
    language: 'en',
    notifications: true
  };

  constructor(vfs: VFS) {
    super('settings', { description: 'User Settings' }, vfs);
  }

  protected async onLoad(): Promise<void> {
    const saved = await this.readJson<UserSettings>('/config.json');
    if (saved) {
      this.settings = { ...this.settings, ...saved };
    }
  }

  /**
   * 获取当前设置
   */
  getSettings(): UserSettings {
    return { ...this.settings };
  }

  /**
   * 更新设置
   */
  async updateSettings(updates: Partial<UserSettings>): Promise<void> {
    this.settings = { ...this.settings, ...updates };
    await this.writeJson('/config.json', this.settings);
    this.notify();
  }

  /**
   * 重置为默认设置
   */
  async resetSettings(): Promise<void> {
    this.settings = {
      theme: 'light',
      language: 'en',
      notifications: true
    };
    await this.writeJson('/config.json', this.settings);
    this.notify();
  }
}

// 使用示例
async function useSettingsService() {
  const vfs = new VFS(await createBrowserVFS());
  
  const settings = new SettingsService(vfs);
  await settings.init();

  // 订阅变更
  settings.onChange(() => {
    console.log('Settings changed:', settings.getSettings());
  });

  // 更新设置
  await settings.updateSettings({ theme: 'dark' });
  
  console.log(settings.getSettings());
  // { theme: 'dark', language: 'en', notifications: true }
}
```

---

## 六、包依赖关系与 Package.json 配置

### 6.1 依赖关系图

```
                              @vfs/vfs (完整包)
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
   @vfs/adapter-session     @vfs/modules            @vfs/sync (可选)
          │                        │                        │
          │                        │                        │
          ▼                        ▼                        ▼
     ┌────┴────┐             ┌─────┴─────┐            ┌─────┴─────┐
     │         │             │           │            │           │
     ▼         ▼             ▼           ▼            ▼           ▼
@vfs/tags  @vfs/assets  @vfs/middleware  │      @vfs/storage-*
     │         │             │           │            │
     └────┬────┘             │           │            │
          │                  │           │            │
          └──────────────────┴─────┬─────┴────────────┘
                                   │
                                   ▼
                              @vfs/core (核心包)
```

