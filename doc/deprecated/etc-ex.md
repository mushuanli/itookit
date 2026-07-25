# VFS etc 模块重构：根文件系统内置 + 扩展权限接口

## 背景与目标

**现状**：`etc` 作为 `CONFIG_MODULE` 通过 `VFSManager.mount()` 以普通模块身份挂载，数据存储于 `/module/etc`。`getEngine('etc')` 能拿到 `IModuleFS` 实例，设备驱动通过 `systemFS: IModuleFS` 代理 `/etc` 隐藏文件。

**目标**：`/etc` 不再作为可挂载模块，而是 rootfs 自带系统目录——与 `/dev`、`/module` 地位相同。由 `VFSEngine.bootstrap()` 在启动时自动创建，永远存在于根文件系统，不可卸载。

**关键发现**：
- `ScopedView` 早已将 `/etc` 映射为 1:1 直通（virtual `/etc` → real `/etc`），只读标记已生效
- `AccessController` 已有 `/etc` 特殊权限规则
- `SYSTEM_DIRS` 已包含 `etc`，bootstrap 已创建该目录
- 唯一让 `etc` 变成"模块"的是 `mount()` 调用和 `getEngine('etc')` 用法

---

## 设计方案

### 1. 根文件系统自带 `/etc`

`/etc` 由 `VFSEngine.bootstrap()` 确保存在，不通过模块注册流程：

```
/               ← rootfs
├── etc/        ← 系统配置（rootfs 内置，bootstrap 创建）
├── dev/        ← 设备文件（rootfs 内置）
├── module/     ← 用户模块挂载点
└── var/        ← 运行时状态（同类，视需要内置）
```

### 2. 系统级 `/etc` 访问方式

`etc` 不再有 `IModuleFS` 实例，改为路径直操作：

| 场景 | 方式 |
|---|---|
| 系统启动配置读写 | `VFSEngine` + `SYSTEM_CALLER` 直接操作 `/etc/...` |
| 设备驱动访问 `/etc` | `ISystemAccess` 接口（见 §5）|
| 普通模块读 `/etc` 非隐藏文件 | `IFSDriver.readContent('/etc/...')` → AccessController 允许只读 |
| 普通模块写 `/etc` | 拒绝（非系统调用者对系统目录只读）|

### 3. 权限控制保留（不变）

**规则一：隐藏文件（`.` 开头）**
- `/etc` 下隐藏文件 → 严格禁止非系统访问，必须通过设备代理
- 其他路径隐藏文件 → 模块可访问自身路径下的隐藏文件

**规则二：系统目录只读**
- `isUnder(path, '/etc') || isUnder(path, '/dev')` + 非系统 caller + write/delete → `FSReadOnlyError`

**规则三：跨模块隔离**
- `/module/<A>/...` 不允许被模块 B 访问

### 4. 扩展权限接口（新增）

```ts
// packages/vfslib/src/engine/access-controller.ts

export interface IAccessPolicy {
  /** 在默认规则之后调用。抛出即拒绝；正常返回即通过。 */
  checkAccess(caller: CallerIdentity, absolutePath: string, operation: AccessOperation): void;
}

export class AccessController {
  private policies: IAccessPolicy[] = [];

  addPolicy(policy: IAccessPolicy): void {
    this.policies.push(policy);
  }

  removePolicy(policy: IAccessPolicy): void {
    this.policies = this.policies.filter(p => p !== policy);
  }

  checkAccess(caller: CallerIdentity, absolutePath: string, operation: AccessOperation): void {
    // ... 原有规则不变 ...

    // 扩展点
    for (const policy of this.policies) {
      policy.checkAccess(caller, absolutePath, operation);
    }
  }
}
```

### 5. 设备代理：`ISystemAccess` 替代 `systemFS: IModuleFS`

```ts
// packages/common/src/interfaces/fs/system-access.ts（新增文件）

export interface ISystemAccess {
  /** 以系统身份读取 /etc 路径（含隐藏文件） */
  readEtc(relativePath: string): Promise<string>;
  /** 以系统身份写入 /etc 路径 */
  writeEtc(relativePath: string, content: string): Promise<void>;
  /** 列出 /etc 目录内容（含隐藏文件） */
  listEtc(relativePath?: string): Promise<string[]>;
}
```

---

## 详细实现步骤

### 步骤 1：新增 `ISystemAccess` 接口

**文件**：`packages/common/src/interfaces/fs/system-access.ts`（新建）

```ts
/**
 * @file common/interfaces/fs/system-access.ts
 * @desc 系统级 /etc 访问接口 — 替代原有的 systemFS: IModuleFS 注入
 */

export interface ISystemAccess {
    /**
     * 以系统身份读取 /etc 下的文件（含隐藏文件）。
     * @param relativePath 相对于 /etc 的路径，如 ".credentials" 或 "public/config.json"
     */
    readEtc(relativePath: string): Promise<string>;

    /**
     * 以系统身份写入 /etc 下的文件。
     * @param relativePath 相对于 /etc 的路径
     * @param content 写入内容
     */
    writeEtc(relativePath: string, content: string): Promise<void>;

    /**
     * 列出 /etc 目录内容（含隐藏文件）。
     * @param relativePath 相对于 /etc 的子目录路径，默认 /
     */
    listEtc(relativePath?: string): Promise<string[]>;
}
```

**文件**：`packages/common/src/interfaces/fs/device/device.ts`（修改）

`DeviceContext.systemFS` 类型变更：

```diff
-    systemFS?: import('../services/module-fs').IModuleFS;
+    systemAccess?: import('../system-access').ISystemAccess;
```

### 步骤 2：`AccessController` 增加策略扩展点

**文件**：`packages/vfslib/src/engine/access-controller.ts`

在 `checkAccess` 方法末尾（`checkCreate` 之前）插入扩展点调用：

```diff
 export class AccessController {
     private systemModuleChecker: ((moduleId: string) => boolean) | null = null;
+    private policies: IAccessPolicy[] = [];

     setSystemModuleChecker(fn: (moduleId: string) => boolean): void {
         this.systemModuleChecker = fn;
     }

+    addPolicy(policy: IAccessPolicy): void {
+        this.policies.push(policy);
+    }
+
+    removePolicy(policy: IAccessPolicy): void {
+        this.policies = this.policies.filter(p => p !== policy);
+    }

     checkAccess(caller, absolutePath, operation): void {
         // ... 原有规则全部保留不变 ...

+        // 扩展点：执行注册的策略（任一抛出即拒绝）
+        for (const policy of this.policies) {
+            policy.checkAccess(caller, absolutePath, operation);
+        }
     }
```

同时在文件顶部新增导出：

```ts
export interface IAccessPolicy {
    checkAccess(caller: CallerIdentity, absolutePath: string, operation: AccessOperation): void;
}
```

### 步骤 3：`VFSEngine` 新增系统级 `/etc` 读写方法

**文件**：`packages/vfslib/src/engine/vfs-engine.ts`

新增方法，供 `ISystemAccess` 实现使用：

```ts
/**
 * 以系统身份写入 /etc 下的路径（绕过 AccessController）。
 * 由 ISystemAccess 实现调用，调用方负责传入已拼接的完整 /etc 路径。
 */
async writeEtcFile(path: string, content: string): Promise<void> {
    const { backend, localPath } = this.resolveStore(path);
    this._inc('write');
    await backend.write(localPath, content, { mode: 'overwrite' });
}

/**
 * 以系统身份读取 /etc 下的路径（绕过 AccessController）。
 */
async readEtcFile(path: string): Promise<string> {
    const { backend, localPath } = this.resolveStore(path);
    try {
        this._inc('read');
        const data = await backend.read(localPath);
        return toString(data.buffer as ArrayBuffer);
    } catch {
        return '';
    }
}

/**
 * 列出 /etc 目录下的条目名称。
 */
async listEtcDir(path: string): Promise<string[]> {
    const { backend, localPath } = this.resolveStore(path);
    this._inc('list');
    const children = await backend.list(localPath);
    return children.map(c => c.name);
}
```

### 步骤 4：`VFSManager` 创建 `ISystemAccess` 实现，删除 `mount('etc')`

**文件**：`packages/vfslib/src/services/vfs-manager.ts`

**4a. 删除 initialize 中的 mount 调用：**

```diff
     async initialize(): Promise<void> {
         if (this.initialized) return;
         await this.engine.initialize();
         this.engine.access.setSystemModuleChecker(
             (moduleId) => this.modules.get(moduleId)?.isSystem ?? false,
         );
-        await this.mount(CONFIG_MODULE, { isSystem: true, description: 'System configuration' });
         this.initialized = true;
     }
```

**4b. 新增 `createSystemAccess()` 工厂方法：**

```ts
import type { ISystemAccess } from '@itookit/common';

private createSystemAccess(): ISystemAccess {
    const engine = this.engine;
    const etcRoot = '/etc';
    return {
        async readEtc(relativePath: string): Promise<string> {
            const fullPath = P.join(etcRoot, relativePath);
            return engine.readEtcFile(fullPath);
        },
        async writeEtc(relativePath: string, content: string): Promise<void> {
            const fullPath = P.join(etcRoot, relativePath);
            // 确保父目录存在
            const parentDir = P.dirname(fullPath);
            await engine.ensureDir(parentDir);
            await engine.writeEtcFile(fullPath, content);
        },
        async listEtc(relativePath: string = ''): Promise<string[]> {
            const fullPath = relativePath ? P.join(etcRoot, relativePath) : etcRoot;
            return engine.listEtcDir(fullPath);
        },
    };
}
```

**4c. 修改 `getEngine()` 中 `systemFS` 注入：**

```diff
     getEngine(moduleName: string): IModuleFS {
         // ...
         const moduleInfo = this.modules.get(moduleName)!;
-        const systemFS = moduleInfo.isSystem
-            ? undefined
-            : this.getEngine(CONFIG_MODULE);
+        const systemAccess = moduleInfo.isSystem
+            ? undefined
+            : this.createSystemAccess();

         const deps: ModuleFSDeps = {
             moduleId: moduleName,
             // ...
-            systemFS,
+            systemAccess,
         };
     }
```

**4d. 修改 `updateTagDefinition()`：**

```diff
     async updateTagDefinition(tagName: string, updates: { color?: string }): Promise<void> {
-        const eng = this.getEngine(CONFIG_MODULE);
-        if (eng.meta.tags?.updateTagDefinition) {
-            await eng.meta.tags.updateTagDefinition(tagName, updates);
-        }
+        // Tag definitions are stored in /etc/tags.json (system-level, not per-module).
+        // This is now handled via ISystemAccess or direct engine operation.
+        const tagsPath = '/etc/tags.json';
+        try {
+            const raw = await this.engine.readEtcFile(tagsPath);
+            const tags = raw ? JSON.parse(raw) : {};
+            if (tags[tagName]) {
+                Object.assign(tags[tagName], updates);
+                const parent = P.dirname(tagsPath);
+                await this.engine.ensureDir(parent);
+                await this.engine.writeEtcFile(tagsPath, JSON.stringify(tags, null, 2));
+            }
+        } catch { /* ignore */ }
     }
```

**4e. 修改 `unmount()` 中的 `CONFIG_MODULE` 守卫：**

```diff
     async unmount(moduleName: string, removeData?: boolean): Promise<void> {
-        if (moduleName === CONFIG_MODULE) {
-            throw new FSError('EINVAL', 'cannot unmount __config', 'unmount');
-        }
+        // etc is not a module anymore — unimplemented guard removed
     }
```

### 步骤 5：`ModuleFS` 适配 `systemFS` → `systemAccess`

**文件**：`packages/vfslib/src/services/module-fs.ts`

**5a. 更新 import：**

```diff
+import type { ISystemAccess } from '@itookit/common';
```

**5b. 更新 `ModuleFSDeps`：**

```diff
 export interface ModuleFSDeps {
     moduleId: string;
     engine: VFSEngine;
     eventBus: EventBus;
     plugins: PluginPipeline;
     access: AccessController;
     devices: DeviceRegistry;
     mountId?: string;
     isSystem?: boolean;
-    systemFS?: import('@itookit/common').IModuleFS;
+    systemAccess?: ISystemAccess;
 }
```

**5c. 更新字段声明和构造函数：**

```diff
-    private readonly systemFS?: import('@itookit/common').IModuleFS;
+    private readonly systemAccess?: ISystemAccess;

     constructor(deps: ModuleFSDeps) {
         // ...
-        this.systemFS = deps.systemFS;
+        this.systemAccess = deps.systemAccess;
     }
```

**5d. 更新 `openDevice()` 中的 `DeviceContext` 注入：**

```diff
     async openDevice(path: string, options?: Record<string, unknown>): Promise<IDeviceHandle> {
         // ...
         const baseCtx: DeviceContext = {
             nodeId: node.path,
             name: node.name,
             metadata: node.metadata,
-            systemFS: this.systemFS,
+            systemAccess: this.systemAccess,
         };
         // ...
     }
```

### 步骤 6：设备驱动迁移指南

所有通过 `ctx.systemFS` 访问 `/etc` 的设备驱动需改为 `ctx.systemAccess`：

**Before（旧）：**
```ts
class MyDeviceDriver implements IDeviceDriver {
    async read(ctx: DeviceContext): Promise<FileContent> {
        const raw = await ctx.systemFS!.driver.readContent('/etc/.myconfig', { encoding: 'utf-8' });
        return { buffer: new TextEncoder().encode(raw as string).buffer, size: 0, encoding: 'utf-8' };
    }
}
```

**After（新）：**
```ts
class MyDeviceDriver implements IDeviceDriver {
    async read(ctx: DeviceContext): Promise<FileContent> {
        const raw = await ctx.systemAccess!.readEtc('.myconfig');
        return { buffer: new TextEncoder().encode(raw).buffer, size: raw.length, encoding: 'utf-8' };
    }
}
```

### 步骤 7：清理 `CONFIG_MODULE` 常量

**文件**：`packages/common/src/interfaces/fs/constants.ts`

```diff
-/** 配置模块名（始终自动挂载，存储所有系统级配置） */
-export const CONFIG_MODULE = 'etc';
+/** 系统配置目录路径（rootfs 内置，始终存在） */
+export const ETC_DIR = '/etc';
```

全局搜索替换 `CONFIG_MODULE` → `ETC_DIR`（在仍需要引用路径的场景），或直接删除不再需要的引用。

### 步骤 8：更新 `common` 导出

**文件**：`packages/common/src/index.ts`（或 interfaces/fs 的 barrel export）

```ts
export type { ISystemAccess } from './interfaces/fs/system-access';
```

---

## 变更范围汇总

| # | 文件 | 操作 | 变更内容 |
|---|---|---|---|
| 1 | `common/src/interfaces/fs/system-access.ts` | **新建** | `ISystemAccess` 接口定义 |
| 2 | `common/src/interfaces/fs/constants.ts` | 修改 | `CONFIG_MODULE` → `ETC_DIR` |
| 3 | `common/src/interfaces/fs/device/device.ts` | 修改 | `DeviceContext.systemFS` → `systemAccess: ISystemAccess` |
| 4 | `common/src/index.ts` | 修改 | 导出 `ISystemAccess` |
| 5 | `vfslib/src/engine/access-controller.ts` | 修改 | 新增 `IAccessPolicy`、`addPolicy/removePolicy`、checkAccess 扩展点 |
| 6 | `vfslib/src/engine/vfs-engine.ts` | 修改 | 新增 `writeEtcFile`、`readEtcFile`、`listEtcDir`、`ensureDir` |
| 7 | `vfslib/src/services/vfs-manager.ts` | 修改 | 删除 `mount('etc')`；新增 `createSystemAccess()`；`getEngine` 改用 `systemAccess`；`updateTagDefinition` 改为直接操作 `/etc`；删除 `unmount` 的 etc 守卫 |
| 8 | `vfslib/src/services/module-fs.ts` | 修改 | `ModuleFSDeps.systemFS` → `systemAccess`；`openDevice` 注入更新 |

| 9 | `vfslib/src/engine/vfs-engine.ts` | 修改 | 新增 `ensureDir()` 递归创建目录；`bootstrap()` 增加 `initDefaultConfig()` 阶段 |
| 10 | `vfslib/src/services/vfs-manager.ts` | 修改 | `createSystemAccess().writeEtc` 写入前调用 `ensureDir` 递归建目录 |

### 不变文件

| 文件 | 原因 |
|---|---|
| `vfslib/src/services/scoped-view.ts` | 已正确映射 `/etc` → `/etc` 直通，无需改动 |
| `vfslib/src/engine/access-controller.ts` 权限规则 | 三条规则依赖 `/etc` 路径，逻辑不变 |

---

## EROFS 问题分析与解决

### 报错链路

```
writeContent('/etc/llm/.providers')       ← 普通模块通过 IFSDriver 写 /etc
  → toRealPath() → '/etc/llm/.providers'  ← ScopedView 1:1 映射
  → assertWritable()                      ← module-fs.ts:249
  → isRealPathReadOnly('/etc/llm/.providers') → true
  → throw FSReadOnlyError('[EROFS] /etc/llm/.providers "etc": read-only filesystem')
```

**根因**：`ScopedView` 将 `/etc` 标记为 `readOnly: true`。`assertWritable` 在所有写操作前检查此标记，但**未考虑系统 caller 身份**。`AccessController.checkAccess` 对 `isSystem: true` 立即放行，`assertWritable` 却先于它拦截。

**修复**：`assertWritable` 增加系统 caller 绕过（与 `AccessController.checkAccess` 一致）：

```ts
// packages/vfslib/src/services/module-fs.ts
private assertWritable(realPath: string): void {
    if (this.caller.isSystem) return;  // ← 新增：系统 caller 绕过 ScopedView 只读检查
    if (this.scope.isRealPathReadOnly(realPath)) throw new FSReadOnlyError(this.moduleId, realPath);
}
```

这样 `getEngine('etc')` → `createEtcEngine()`（`isSystem: true`）的写操作即可正常通过，无需额外迁移 `ISystemAccess`。

### 缺失的两个能力

| # | 问题 | 说明 |
|---|---|---|
| 1 | **无递归 `ensureDir`** | 写入 `/etc/llm/.providers` 前需确保 `/etc/llm/` 目录存在，当前无递归创建能力 |
| 2 | **无默认配置初始化** | bootstrap 只建了 `/etc` 空目录，`/etc/llm/.providers` 等默认配置文件从未自动创建 |

---

## 补充实现步骤

### 步骤 9：`VFSEngine` 新增递归 `ensureDir`

**文件**：`packages/vfslib/src/engine/vfs-engine.ts`

```ts
/**
 * 递归创建目录（类似 mkdir -p）。
 * 仅系统内部使用，不走 AccessController。
 */
async ensureDir(path: string): Promise<void> {
    const { backend, localPath } = this.resolveStore(path);
    const segments = localPath.split('/').filter(Boolean);
    let current = '';
    for (const seg of segments) {
        current += '/' + seg;
        this._inc('stat');
        const existing = await backend.stat(current);
        if (!existing) {
            this._inc('mkdir');
            await backend.mkdir(current);
        }
    }
}
```

### 步骤 10：`ISystemAccess.writeEtc` 自动建目录

**文件**：`packages/vfslib/src/services/vfs-manager.ts`

`createSystemAccess()` 中的 `writeEtc` 实现：

```ts
private createSystemAccess(): ISystemAccess {
    const engine = this.engine;
    const etcRoot = '/etc';
    return {
        async readEtc(relativePath: string): Promise<string> {
            return engine.readEtcFile(P.join(etcRoot, relativePath));
        },
        async writeEtc(relativePath: string, content: string): Promise<void> {
            const fullPath = P.join(etcRoot, relativePath);
            // 递归确保父目录存在
            const parentDir = P.dirname(fullPath);
            await engine.ensureDirectoryPath(parentDir);
            await engine.writeEtcFile(fullPath, content);
        },
        async listEtc(relativePath: string = ''): Promise<string[]> {
            const fullPath = relativePath ? P.join(etcRoot, relativePath) : etcRoot;
            return engine.listEtcDir(fullPath);
        },
    };
}
```

### 步骤 11：Bootstrap 阶段初始化默认配置目录

**文件**：`packages/vfslib/src/engine/vfs-engine.ts`

在 `bootstrap()` 中增加 `initDefaultConfig()` 调用：

```ts
private async bootstrap(): Promise<void> {
    // Ensure root and system directories exist
    if (!(await this.backend.stat('/'))) {
        await this.backend.mkdir('/');
    }
    for (const dirName of SYSTEM_DIRS) {
        if (!(await this.backend.stat(`/${dirName}`))) {
            await this.backend.mkdir(`/${dirName}`);
        }
    }
    // Ensure default system subdirectories exist (idempotent)
    await this.initDefaultConfig();
}

/**
 * Ensure default system subdirectories under /etc exist.
 * Idempotent — does not overwrite existing files or directories.
 * Actual config file initialization is handled by the app layer via
 * ConfigService / ISystemAccess on first write.
 */
private async initDefaultConfig(): Promise<void> {
    const etcSubdirs = ['/etc/llm'];
    for (const dir of etcSubdirs) {
        await this.ensureDirectoryPath(dir);
    }
}
```

> **设计决策**：默认配置文件（如 `/etc/llm/.providers`）的具体内容由 app 层负责，
> 通过 `factory.ts` 的 `initialConfigs` 选项或 `ConfigService.setBatch()` 首次写入。
> engine 层只保证目录结构就绪，不耦合业务配置内容。

### 步骤 12：VFSEngine 暴露 `initDefaultConfig` 使用的方法签名

`writeEtcFile` 和 `readEtcFile` 需定义为 `public`，供 `ISystemAccess` 和 `initDefaultConfig` 共同使用。`ensureDir` 同样 `public`。

```ts
// vfs-engine.ts 中这些方法为 public：

/** 递归创建目录（mkdir -p），不走 AccessController */
async ensureDir(path: string): Promise<void> { ... }

/** 以系统内部身份写入 /etc 下文件，不走 AccessController */
async writeEtcFile(path: string, content: string): Promise<void> { ... }

/** 以系统内部身份读取 /etc 下文件，不走 AccessController */
async readEtcFile(path: string): Promise<string> { ... }

/** 列出 /etc 目录条目名称 */
async listEtcDir(path: string): Promise<string[]> { ... }
```

---

## 完整调用链（初始化 → 读写）

```
VFSManager.initialize()
  → engine.initialize()
    → bootstrap()
      → mkdir /etc, /dev, /module
      → initDefaultConfig()
        → ensureDir('/etc/llm')
        → writeEtcFile('/etc/llm/.providers', '{...}')    ← 系统身份，绕过权限
        → writeEtcFile('/etc/llm/.connections', '{...}')

运行时：设备驱动读 /etc 隐藏配置
  → ctx.systemAccess!.readEtc('.providers')
    → engine.readEtcFile('/etc/.providers')               ← 系统身份，绕过权限
    → 返回内容给设备驱动（驱动可做过滤/脱敏）

运行时：设备驱动写 /etc 隐藏配置
  → ctx.systemAccess!.writeEtc('.providers', newContent)
    → ensureDir('/etc/')  ← 已存在，跳过
    → engine.writeEtcFile('/etc/.providers', newContent)  ← 系统身份
```

## EROFS 防御对照

| 调用入口 | 路径检查 | 结果 |
|---|---|---|
| `IFSDriver.writeContent('/etc/...')` by 普通模块 | `assertWritable` → `isRealPathReadOnly` → `true`, `isSystem: false` | EROFS（预期拒绝）|
| `IFSDriver.writeContent` by `getEngine('etc')` | `assertWritable` → `isSystem: true` → 跳过检查 | 允许（系统身份）|
| `ISystemAccess.writeEtc('...')` | 不走 `IFSDriver`/`AccessController`，直接 `engine.writeEtcFile` | 允许（系统身份）|
| `IFSDriver.readContent('/etc/public/...')` | `AccessController.checkAccess` → 只读允许 | 允许（非隐藏文件）|
| `IFSDriver.readContent('/etc/.providers')` | `AccessController.checkAccess` → 隐藏文件拒绝 | AccessDenied（预期拒绝）|

- `getEngine('etc')` → `FSModuleNotFoundError`，调用方迁移为 `ISystemAccess` 或 `VFSEngine.readEtcFile/writeEtcFile`
- `DeviceContext.systemFS` → `systemAccess`，设备驱动需更新属性访问
- `CONFIG_MODULE` 常量 → `ETC_DIR`，全局替换
- `mount('etc', ...)` 调用方需删除（etc 不再可 mount）
