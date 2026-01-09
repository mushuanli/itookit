## 答案：不需要修改

您的 `apps/web-app/src/services/vfs.ts` 代码**完全兼容**重构后的架构，无需任何修改。

### 原因分析

重构后的 `VFSCore` 保持了完全的**向后兼容性**：

| API | 原版本 | 重构版本 | 兼容性 |
|-----|--------|----------|--------|
| `createVFSCore('MindOS')` | ✅ 支持字符串参数 | ✅ 继续支持 | ✅ 完全兼容 |
| `getModule(name)` | ✅ | ✅ | ✅ 完全兼容 |
| `mount(name, options)` | ✅ 支持对象参数 | ✅ 继续支持 | ✅ 完全兼容 |

### 代码对照

```typescript
// 您的代码（无需修改）
vfsInstance = await createVFSCore('MindOS');

// 重构后的 createVFSCore 函数签名
export function createVFSCore(config: VFSConfig): Promise<VFSCore>;
export function createVFSCore(dbName: string, defaultModule?: string): Promise<VFSCore>;
//                            ^^^^^^^^^^^^^^ 继续支持字符串参数
```

```typescript
// 您的代码（无需修改）
await vfsInstance.mount(ws.moduleName, {
    description: ws.title,
    isProtected: ws.isProtected
});

// 重构后的 mount 方法签名
async mount(
  moduleName: string, 
  options: string | { description?: string; isProtected?: boolean; syncEnabled?: boolean } = {}
): Promise<ModuleInfo>
// ^^^^^^^ 继续支持对象参数，新增了 syncEnabled 选项（可选）
```

### 如果未来想使用新功能

只有当您想要使用**新增功能**时才需要修改代码：

```typescript
// 示例：切换到 SQLite 存储
import { createSQLiteVFS } from '@itookit/vfs-core';

vfsInstance = await createSQLiteVFS('./data/mindos.db', sqliteDriver);

// 示例：启用远程同步
import { createSyncableVFS } from '@itookit/vfs-core';

vfsInstance = await createSyncableVFS('https://api.example.com/sync', {
  dbName: 'MindOS',
  sync: {
    options: {
      scope: { modules: ['notes', 'documents'] }
    }
  }
});

// 示例：使用内存存储进行测试
import { createMemoryVFS } from '@itookit/vfs-core';

vfsInstance = await createMemoryVFS({ defaultModule: 'test' });
```

### 总结

| 场景 | 是否需要修改 |
|------|-------------|
| 继续使用 IndexedDB | ❌ 不需要 |
| 切换到 SQLite | ✅ 需要修改初始化代码 |
| 启用远程同步 | ✅ 需要修改初始化代码 |
| 使用内存存储测试 | ✅ 需要修改初始化代码 |
## 当前架构的同步能力分析

是的，我设计的架构**完整支持**您提到的所有功能。让我详细说明：

---

## 一、增量同步支持 ✅

### 1.1 双向增量同步场景

```
┌─────────────────────────────────────────────────────────────────┐
│                    设备 A 和 B 增量同步示例                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  设备 A (本地)              远程服务器              设备 B (本地)  │
│  ┌──────────┐              ┌──────────┐           ┌──────────┐  │
│  │ file1.md │              │          │           │ file2.md │  │
│  │ file3.md │              │  (空)    │           │ file4.md │  │
│  └──────────┘              └──────────┘           └──────────┘  │
│       │                         │                      │        │
│       │ ──── push ────────────► │                      │        │
│       │                         │ ◄──── push ───────── │        │
│       │                         │                      │        │
│       │ ◄─── pull ───────────── │                      │        │
│       │                         │ ───── pull ────────► │        │
│       ▼                         ▼                      ▼        │
│  ┌──────────┐              ┌──────────┐           ┌──────────┐  │
│  │ file1.md │              │ file1.md │           │ file1.md │  │
│  │ file2.md │              │ file2.md │           │ file2.md │  │
│  │ file3.md │              │ file3.md │           │ file3.md │  │
│  │ file4.md │              │ file4.md │           │ file4.md │  │
│  └──────────┘              └──────────┘           └──────────┘  │
│                                                                 │
│  结果：两台设备都有完整的 4 个文件                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 增量同步实现原理

```typescript
// @file vfs/sync/SyncEngine.ts (核心机制)

/**
 * 变更追踪使用向量时钟实现增量同步
 */
interface ChangeRecord {
  id: string;
  collection: string;
  key: unknown;
  operation: 'create' | 'update' | 'delete';
  timestamp: number;
  data?: unknown;
  
  /** 向量时钟 - 用于检测并发修改和增量同步 */
  vectorClock: Record<string, number>;
  // 例如: { "device_A": 5, "device_B": 3 }
  // 表示这个变更在设备A的第5次操作后产生，设备B的时钟是3
}

/**
 * 同步引擎会：
 * 1. 记录每次本地修改
 * 2. 只推送未同步的变更（增量）
 * 3. 只拉取比本地时钟新的变更（增量）
 */
```

---

## 二、时间范围和表范围限制 ✅

### 2.1 完整的范围控制接口

```typescript
// @file vfs/sync/interfaces/ISyncAdapter.ts

/**
 * 同步范围配置
 */
export interface SyncScope {
  // ==================== 模块/目录级别 ====================
  
  /** 包含的模块 (空数组表示全部) */
  modules?: string[];
  // 例如: ['notes', 'documents'] - 只同步这两个模块
  
  /** 排除的模块 */
  excludeModules?: string[];
  // 例如: ['temp', 'cache'] - 不同步临时模块
  
  /** 包含的路径前缀 */
  includePaths?: string[];
  // 例如: ['/shared/', '/public/'] - 只同步这些目录
  
  /** 排除的路径前缀 */
  excludePaths?: string[];
  // 例如: ['/drafts/', '/.trash/'] - 不同步草稿和回收站

  // ==================== 表级别 ====================
  
  /** 同步的集合/表 */
  collections?: string[];
  // 例如: ['vnodes', 'vfs_contents'] - 只同步文件数据
  
  /** 排除的集合/表 */
  excludeCollections?: string[];
  // 例如: ['srs_items'] - 不同步 SRS 复习数据
}

/**
 * 同步配置
 */
export interface SyncConfig {
  direction: SyncDirection;
  scope: SyncScope;
  
  // ==================== 时间范围 ====================
  
  /** 时间范围限制 */
  timeRange?: {
    /** 只同步此时间之后的变更 */
    since?: Date;
    // 例如: new Date('2024-01-01') - 只同步2024年后的数据
    
    /** 只同步此时间之前的变更 */
    until?: Date;
    // 例如: new Date() - 只同步到当前时间
  };
  
  conflictResolution: ConflictStrategy;
}
```

### 2.2 使用示例

```typescript
// 示例：精细控制同步范围

const vfs = await createSyncableVFS('https://api.example.com/sync', {
  sync: {
    options: {
      direction: SyncDirection.BIDIRECTIONAL,
      
      scope: {
        // 只同步特定模块
        modules: ['notes', 'documents', 'shared'],
        
        // 排除某些模块
        excludeModules: ['__vfs_meta__', 'temp'],
        
        // 只同步特定目录
        includePaths: ['/projects/', '/shared/'],
        
        // 排除草稿和临时目录
        excludePaths: ['/drafts/', '/.trash/', '/temp/'],
        
        // 只同步文件数据，不同步 SRS
        excludeCollections: ['srs_items']
      },
      
      // 只同步最近30天的变更
      timeRange: {
        since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      },
      
      conflictResolution: ConflictStrategy.LATEST_WINS
    }
  }
});
```

---

## 三、单向同步和强制覆盖 ✅

### 3.1 同步方向枚举

```typescript
/**
 * 同步方向
 */
export enum SyncDirection {
  /** 本地 → 远程 (只推送) */
  PUSH = 'push',
  
  /** 远程 → 本地 (只拉取) */
  PULL = 'pull',
  
  /** 双向同步 */
  BIDIRECTIONAL = 'bidirectional'
}
```

### 3.2 冲突解决策略（强制覆盖）

```typescript
/**
 * 冲突解决策略
 */
export enum ConflictStrategy {
  /** 本地优先（强制覆盖远程） */
  LOCAL_WINS = 'local_wins',
  
  /** 远程优先（强制覆盖本地） */
  REMOTE_WINS = 'remote_wins',
  
  /** 最新修改优先 */
  LATEST_WINS = 'latest_wins',
  
  /** 手动解决 */
  MANUAL = 'manual'
}
```

### 3.3 各种同步场景示例

```typescript
// ==================== 场景 1: 强制推送本地到远程（覆盖远程） ====================

async function forceOverwriteRemote() {
  const vfs = await createSyncableVFS('https://api.example.com/sync', {
    sync: {
      options: {
        direction: SyncDirection.PUSH,  // 只推送
        scope: {},
        conflictResolution: ConflictStrategy.LOCAL_WINS  // 本地优先
      }
    }
  });

  // 强制推送所有本地变更，覆盖远程冲突数据
  await vfs.pushChanges();
}

// ==================== 场景 2: 强制拉取远程到本地（覆盖本地） ====================

async function forceOverwriteLocal() {
  const vfs = await createSyncableVFS('https://api.example.com/sync', {
    sync: {
      options: {
        direction: SyncDirection.PULL,  // 只拉取
        scope: {},
        conflictResolution: ConflictStrategy.REMOTE_WINS  // 远程优先
      }
    }
  });

  // 强制拉取远程数据，覆盖本地冲突数据
  await vfs.pullChanges();
}

// ==================== 场景 3: 自动备份（单向推送） ====================

async function autoBackup() {
  const vfs = await createSyncableVFS('https://backup.example.com/sync', {
    sync: {
      options: {
        direction: SyncDirection.PUSH,
        scope: {
          excludeModules: ['temp', 'cache'],
          excludePaths: ['/.trash/']
        },
        conflictResolution: ConflictStrategy.LOCAL_WINS
      },
      autoSyncInterval: 300000  // 5分钟自动备份
    }
  });

  // 本地的所有更改会自动推送到远程备份
}

// ==================== 场景 4: 从备份恢复（单向拉取） ====================

async function restoreFromBackup() {
  const vfs = await createSyncableVFS('https://backup.example.com/sync', {
    sync: {
      options: {
        direction: SyncDirection.PULL,
        scope: {},
        conflictResolution: ConflictStrategy.REMOTE_WINS,
        timeRange: {
          // 恢复特定时间点之前的数据
          until: new Date('2024-01-15T10:00:00')
        }
      }
    }
  });

  await vfs.pullChanges();
  console.log('Restored from backup');
}

// ==================== 场景 5: 选择性同步特定模块 ====================

async function selectiveSync() {
  const vfs = await createSyncableVFS('https://api.example.com/sync', {
    sync: {
      options: {
        direction: SyncDirection.BIDIRECTIONAL,
        scope: {
          modules: ['shared'],  // 只同步 shared 模块
        },
        conflictResolution: ConflictStrategy.LATEST_WINS
      }
    }
  });

  // 只有 shared 模块会双向同步
  // 其他模块保持本地状态
}

// ==================== 场景 6: 动态切换同步策略 ====================

async function dynamicSyncStrategy() {
  const vfs = await createVFSCore({
    dbName: 'dynamic_vfs',
    sync: { enabled: true, remote: { type: 'http', endpoint: '...' } }
  });
  await vfs.init();

  // 场景A: 早上开始工作时，拉取远程最新数据
  await vfs.syncNow({
    direction: SyncDirection.PULL,
    scope: {},
    conflictResolution: ConflictStrategy.REMOTE_WINS
  });

  // ... 进行一天的工作 ...

  // 场景B: 晚上结束工作时，推送本地变更
  await vfs.syncNow({
    direction: SyncDirection.PUSH,
    scope: {},
    conflictResolution: ConflictStrategy.LOCAL_WINS
  });

  // 场景C: 临时同步特定目录
  await vfs.syncNow({
    direction: SyncDirection.BIDIRECTIONAL,
    scope: {
      includePaths: ['/urgent-project/']
    },
    conflictResolution: ConflictStrategy.LATEST_WINS
  });
}
```

---

## 四、完整功能矩阵

| 功能 | 支持状态 | 说明 |
|------|---------|------|
| **增量同步** | ✅ 支持 | 使用向量时钟追踪变更，只同步差异 |
| **双向同步** | ✅ 支持 | `SyncDirection.BIDIRECTIONAL` |
| **单向推送** | ✅ 支持 | `SyncDirection.PUSH` |
| **单向拉取** | ✅ 支持 | `SyncDirection.PULL` |
| **强制覆盖本地** | ✅ 支持 | `ConflictStrategy.REMOTE_WINS` |
| **强制覆盖远程** | ✅ 支持 | `ConflictStrategy.LOCAL_WINS` |
| **最新优先** | ✅ 支持 | `ConflictStrategy.LATEST_WINS` |
| **手动解决冲突** | ✅ 支持 | `ConflictStrategy.MANUAL` + `resolveConflict()` |
| **模块范围限制** | ✅ 支持 | `scope.modules` / `scope.excludeModules` |
| **路径范围限制** | ✅ 支持 | `scope.includePaths` / `scope.excludePaths` |
| **表范围限制** | ✅ 支持 | `scope.collections` / `scope.excludeCollections` |
| **时间范围限制** | ✅ 支持 | `timeRange.since` / `timeRange.until` |
| **自动定时同步** | ✅ 支持 | `autoSyncInterval` |
| **HTTP 同步** | ✅ 支持 | `HttpSyncAdapter` |
| **WebSocket 实时同步** | ✅ 支持 | `WebSocketSyncAdapter` |

---

## 五、高级用例：多设备完整同步

```typescript
/**
 * 实现两台设备合并数据的完整流程
 */
async function fullDeviceSync() {
  const vfs = await createSyncableVFS('https://api.example.com/sync', {
    dbName: 'MindOS',
    sync: {
      remote: {
        type: 'http',
        endpoint: 'https://api.example.com/sync',
        auth: { type: 'bearer', token: 'user-token' }
      },
      options: {
        direction: SyncDirection.BIDIRECTIONAL,
        scope: {
          // 同步所有用户模块```typescript
/**
 * 实现两台设备合并数据的完整流程
 */
async function fullDeviceSync() {
  const vfs = await createSyncableVFS('https://api.example.com/sync', {
    dbName: 'MindOS',
    sync: {
      remote: {
        type: 'http',
        endpoint: 'https://api.example.com/sync',
        auth: { type: 'bearer', token: 'user-token' }
      },
      options: {
        direction: SyncDirection.BIDIRECTIONAL,
        scope: {
          // 同步所有用户模块，排除系统模块
          excludeModules: ['__vfs_meta__'],
          // 不同步临时文件
          excludePaths: ['/.trash/', '/temp/', '/cache/'],
          // 不同步 SRS 复习状态（每个设备独立）
          excludeCollections: ['srs_items']
        },
        // 使用最新修改优先策略
        conflictResolution: ConflictStrategy.LATEST_WINS
      },
      // 每60秒自动同步
      autoSyncInterval: 60000
    }
  });

  // 首次同步：获取完整数据
  console.log('Starting initial sync...');
  const result = await vfs.syncNow();
  
  console.log(`Initial sync complete:`);
  console.log(`  - Pushed: ${result.pushed} changes`);
  console.log(`  - Pulled: ${result.pulled} changes`);
  console.log(`  - Conflicts: ${result.conflicts}`);

  // 处理可能的冲突
  if (result.conflicts > 0) {
    const conflicts = await vfs.getConflicts();
    
    for (const conflict of conflicts) {
      console.log(`Conflict detected in ${conflict.collection}:`);
      console.log(`  - Local version: ${JSON.stringify(conflict.localVersion.data)}`);
      console.log(`  - Remote version: ${JSON.stringify(conflict.remoteVersion.data)}`);
      
      // 自动使用最新版本（或让用户选择）
      const useLocal = conflict.localVersion.timestamp > conflict.remoteVersion.timestamp;
      await vfs.resolveConflict(conflict.id, useLocal ? 'local' : 'remote');
    }
  }

  // 监听同步事件
  vfs.getEventBus().on('sync:complete' as any, (event: any) => {
    console.log('Sync completed:', event);
  });

  vfs.getEventBus().on('conflict:detected' as any, (event: any) => {
    console.warn('New conflict:', event);
    // 可以弹出 UI 让用户处理
  });

  return vfs;
}
```

---

## 六、实际应用场景示例

### 6.1 场景：桌面端 + 移动端同步

```typescript
/**
 * 桌面端配置：完整数据 + 实时同步
 */
async function setupDesktopSync() {
  return createSyncableVFS('wss://sync.example.com/ws', {
    dbName: 'MindOS_Desktop',
    sync: {
      remote: {
        type: 'websocket',  // 使用 WebSocket 实时同步
        endpoint: 'wss://sync.example.com/ws',
        auth: { type: 'bearer', token: 'user-token' }
      },
      options: {
        direction: SyncDirection.BIDIRECTIONAL,
        scope: {}, // 同步全部数据
        conflictResolution: ConflictStrategy.LATEST_WINS
      }
    }
  });
}

/**
 * 移动端配置：选择性同步 + 节省流量
 */
async function setupMobileSync() {
  return createSyncableVFS('https://sync.example.com/api', {
    dbName: 'MindOS_Mobile',
    sync: {
      remote: {
        type: 'http',  // 使用 HTTP（节省电量）
        endpoint: 'https://sync.example.com/api',
        auth: { type: 'bearer', token: 'user-token' }
      },
      options: {
        direction: SyncDirection.BIDIRECTIONAL,
        scope: {
          // 移动端只同步重要模块
          modules: ['notes', 'tasks', 'favorites'],
          // 不同步大型附件目录
          excludePaths: ['/attachments/', '/videos/'],
          // 不同步大文件内容表
          excludeCollections: ['vfs_contents']  // 只同步元数据
        },
        // 只同步最近7天的内容
        timeRange: {
          since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        },
        conflictResolution: ConflictStrategy.REMOTE_WINS  // 移动端让步于桌面端
      },
      // 手动同步（节省流量）
      autoSyncInterval: undefined
    }
  });
}
```

### 6.2 场景：团队协作同步

```typescript
/**
 * 团队协作：共享目录同步 + 私有目录隔离
 */
async function setupTeamSync(userId: string, teamId: string) {
  const vfs = await createSyncableVFS('https://team.example.com/sync', {
    dbName: `MindOS_${userId}`,
    sync: {
      remote: {
        type: 'websocket',
        endpoint: `wss://team.example.com/sync/${teamId}`,
        auth: { type: 'bearer', token: 'team-token' }
      },
      options: {
        direction: SyncDirection.BIDIRECTIONAL,
        scope: {
          // 只同步团队共享模块
          modules: ['team-shared', 'team-projects'],
          // 包含特定共享目录
          includePaths: ['/shared/', '/public/'],
          // 排除私有目录
          excludePaths: ['/private/', '/drafts/', `/${userId}/`]
        },
        conflictResolution: ConflictStrategy.LATEST_WINS
      },
      autoSyncInterval: 10000  // 10秒实时同步
    }
  });

  return vfs;
}

/**
 * 个人私有数据：单独备份通道
 */
async function setupPrivateBackup(userId: string) {
  const vfs = VFSCore.getInstance();  // 获取已有实例
  
  // 创建第二个同步通道用于私有备份
  const privateSync = new SyncEngine(vfs.getVFS().storage as any);
  
  await privateSync.connect(
    new HttpSyncAdapter(),
    {
      type: 'http',
      endpoint: `https://backup.example.com/user/${userId}`,
      auth: { type: 'bearer', token: 'private-token' }
    }
  );

  privateSync.configure({
    direction: SyncDirection.PUSH,  // 只备份，不拉取
    scope: {
      modules: ['personal', 'private'],
      includePaths: [`/${userId}/`, '/private/']
    },
    conflictResolution: ConflictStrategy.LOCAL_WINS
  });

  return privateSync;
}
```

### 6.3 场景：离线优先 + 上线同步

```typescript
/**
 * 离线优先应用：检测网络状态并同步
 */
async function setupOfflineFirstSync() {
  const vfs = await createVFSCore({
    dbName: 'MindOS_Offline',
    sync: {
      enabled: true,
      remote: {
        type: 'http',
        endpoint: 'https://api.example.com/sync',
        auth: { type: 'bearer', token: 'user-token' }
      },
      options: {
        direction: SyncDirection.BIDIRECTIONAL,
        scope: {},
        conflictResolution: ConflictStrategy.LATEST_WINS
      }
      // 不设置 autoSyncInterval，手动控制
    }
  });

  // 监听网络状态
  let isOnline = navigator.onLine;

  window.addEventListener('online', async () => {
    console.log('Network online, starting sync...');
    isOnline = true;
    
    try {
      // 上线后立即同步
      const result = await vfs.syncNow();
      console.log(`Synced after coming online: pushed ${result.pushed}, pulled ${result.pulled}`);
      
      // 启动自动同步
      vfs.startAutoSync(30000);
    } catch (e) {
      console.error('Sync failed:', e);
    }
  });

  window.addEventListener('offline', () => {
    console.log('Network offline, stopping sync...');
    isOnline = false;
    vfs.stopAutoSync();
  });

  // 提供手动同步按钮
  return {
    vfs,
    isOnline: () => isOnline,
    manualSync: async () => {
      if (!isOnline) {
        throw new Error('Cannot sync while offline');
      }
      return vfs.syncNow();
    },
    getPendingChanges: () => vfs.sync?.getPendingChanges()
  };
}
```

### 6.4 场景：定时增量备份

```typescript
/**
 * 每日增量备份方案
 */
async function setupDailyBackup() {
  const vfs = await createVFSCore({
    dbName: 'MindOS',
    sync: {
      enabled: true,
      remote: {
        type: 'http',
        endpoint: 'https://backup.example.com/daily',
        auth: { type: 'bearer', token: 'backup-token' }
      },
      options: {
        direction: SyncDirection.PUSH,
        scope: {
          excludeModules: ['temp', 'cache', '__vfs_meta__'],
          excludePaths: ['/.trash/']
        },
        conflictResolution: ConflictStrategy.LOCAL_WINS
      }
    }
  });

  // 计算下次备份时间（每天凌晨3点）
  function getNextBackupTime(): number {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime() - now.getTime();
  }

  // 定时备份
  async function scheduleBackup() {
    const delay = getNextBackupTime();
    console.log(`Next backup in ${Math.round(delay / 1000 / 60)} minutes`);

    setTimeout(async () => {
      try {
        console.log('Starting daily backup...');
        
        // 只备份最近24小时的变更
        const result = await vfs.syncNow({
          direction: SyncDirection.PUSH,
          scope: {},
          timeRange: {
            since: new Date(Date.now() - 24 * 60 * 60 * 1000)
          },
          conflictResolution: ConflictStrategy.LOCAL_WINS
        });

        console.log(`Daily backup complete: ${result.pushed} changes pushed`);
      } catch (e) {
        console.error('Backup failed:', e);
      }

      // 安排下次备份
      scheduleBackup();
    }, delay);
  }

  scheduleBackup();
  return vfs;
}
```

---

## 七、API 快速参考

```typescript
// ==================== 基础同步操作 ====================

// 手动触发同步（使用默认配置）
await vfs.syncNow();

// 手动触发同步（自定义配置）
await vfs.syncNow({
  direction: SyncDirection.BIDIRECTIONAL,
  scope: { modules: ['notes'] },
  timeRange: { since: new Date('2024-01-01') },
  conflictResolution: ConflictStrategy.LATEST_WINS
});

// 只推送
await vfs.pushChanges();
await vfs.pushChanges({ modules: ['important'] });

// 只拉取
await vfs.pullChanges();
await vfs.pullChanges({ excludePaths: ['/large-files/'] });

// ==================== 同步状态 ====================

// 获取同步状态
const state = vfs.getSyncState();
console.log(state.status);        // 'idle' | 'syncing' | 'error' | 'paused'
console.log(state.lastSyncAt);    // 时间戳
console.log(state.pendingChanges); // 待同步数量
console.log(state.conflicts);     // 冲突数量

// ==================== 冲突管理 ====================

// 获取冲突列表
const conflicts = await vfs.getConflicts();

// 解决冲突
await vfs.resolveConflict(conflictId, 'local');   // 使用本地版本
await vfs.resolveConflict(conflictId, 'remote');  // 使用远程版本
await vfs.resolveConflict(conflictId, { merged: mergedData }); // 使用合并数据

// ==================== 自动同步控制 ====================

// 启动自动同步
vfs.startAutoSync(30000);  // 30秒间隔

// 停止自动同步
vfs.stopAutoSync();

// ==================== 动态配置 ====================

// 修改同步范围
vfs.configureSyncScope({
  modules: ['notes', 'documents'],
  excludePaths: ['/drafts/']
});
```

---

## 八、总结

| 您的需求 | 实现方式 | 示例代码 |
|---------|---------|---------|
| 两设备数据合并 | `SyncDirection.BIDIRECTIONAL` | `await vfs.syncNow()` |
| 增量同步 | 向量时钟自动追踪 | 自动实现 |
| 限制时间范围 | `timeRange: { since, until }` | `timeRange: { since: new Date(...) }` |
| 限制表范围 | `scope.collections` / `excludeCollections` | `excludeCollections: ['srs_items']` |
| 限制模块范围 | `scope.modules` / `excludeModules` | `modules: ['notes']` |
| 限制路径范围 | `scope.includePaths` / `excludePaths` | `excludePaths: ['/drafts/']` |
| 单向推送 | `SyncDirection.PUSH` | `await vfs.pushChanges()` |
| 单向拉取 | `SyncDirection.PULL` | `await vfs.pullChanges()` |
| 强制覆盖本地 | `ConflictStrategy.REMOTE_WINS` | 配置中设置 |
| 强制覆盖远程 | `ConflictStrategy.LOCAL_WINS` | 配置中设置 |
| 最新优先 | `ConflictStrategy.LATEST_WINS` | 配置中设置 |
| 手动解决冲突 | `ConflictStrategy.MANUAL` + API | `await vfs.resolveConflict(