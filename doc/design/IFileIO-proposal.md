# IFileIO / IMDFileIO / IChatFileIO 接口层次设计

## 核心思想

将"文件 + assetdir"视为**一个不可分割的整体**进行读写操作。
这层接口位于 `ISessionEngine` 之上，封装了 assetdir 的命名约定、引用解析、生命周期管理。

```
消费者 (MDX / Chat / Settings)
    │
    ├── IMDFileIO / IChatFileIO     ← 格式特定的高层接口 (NEW)
    │       └── IFileIO              ← 通用文件+assetdir 整体操作 (NEW)
    │
    ├── ISessionEngine               ← 扁平 VFS 操作 (保留，供底层使用)
    │
    └── IModuleFS.assets             ← VFS 原始 assetdir 操作
```

## IFileIO — 泛用文件+assetdir 整体接口

```typescript
// @file common/interfaces/IFileIO.ts

/**
 * 文件句柄 — 封装一个文件及其伴生 assetdir 的整体操作。
 *
 * 实现类保证以下语义：
 *  - 写入 asset 时自动创建 assetdir
 *  - 删除文件时级联删除 assetdir
 *  - 重命名文件时同步重命名 assetdir
 *
 * 通过工厂创建: createFileIO(engine: ISessionEngine, nodeId: string): IFileIO
 */
export interface IFileIO {
    // ========== 身份 ==========
    readonly nodeId: string;
    getName(): Promise<string>;
    getPath(): Promise<string>;
    getNode(): Promise<EngineNode>;

    // ========== 主体内容读写 ==========
    /** 读取文件主体内容 */
    read(): Promise<string | ArrayBuffer>;
    /** 写入文件主体内容 */
    write(content: string | ArrayBuffer): Promise<void>;

    // ========== 资产操作 (封装 assetdir) ==========
    /**
     * 写入资产到伴生 assetdir。
     * assetdir 不存在时自动创建。
     * @returns 资产引用路径（如 @asset/image.png），可直接嵌入文档
     */
    putAsset(name: string, content: string | ArrayBuffer): Promise<string>;
    /** 读取资产内容 */
    getAsset(name: string): Promise<ArrayBuffer | null>;
    /** 列出所有资产名称 */
    listAssets(): Promise<string[]>;
    /** 删除单个资产 */
    deleteAsset(name: string): Promise<void>;
    /** 检查是否有资产目录 */
    hasAssetDir(): Promise<boolean>;

    // ========== 生命周期 ==========
    /** 重命名文件（同步重命名 assetdir） */
    rename(newName: string): Promise<void>;
    /**
     * 清理未被引用的资产
     * 基类通过传入引用扫描器实现。
     * @returns 删除的资产数量，无 assetdir 返回 null
     */
    pruneAssets(referencedNames: string[]): Promise<number | null>;

    // ========== 事件 ==========
    on(event: EngineEventType, callback: (event: EngineEvent) => void): () => void;
}
```

## IMDFileIO — MDX 文件的特化接口

```typescript
// @file common/interfaces/IMDFileIO.ts

import { IFileIO } from './IFileIO';

/**
 * MDX 文件 I/O 接口
 *
 * 在 IFileIO 基础上增加了 Markdown 特有的能力：
 *  - @asset/ 引用解析
 *  - 从内容中提取引用的资产列表
 *  - 自动 prune（扫描文档内容，删除未引用的资产）
 */
export interface IMDFileIO extends IFileIO {
    /**
     * 解析文档中的 @asset/ 引用，将 @asset/xxx 替换为 Blob URL
     * @param content 原始 Markdown 文本
     * @returns 替换 @asset/ 引用后的文本
     */
    resolveAssetReferences(content: string): Promise<string>;

    /**
     * 从内容中提取所有 @asset/ 引用的文件名
     */
    extractReferencedAssets(content: string): string[];

    /**
     * 自动清理：扫描文档内容，删除所有未被 @asset/ 引用的资产
     */
    pruneUnusedAssets(): Promise<number>;
}
```

## IChatFileIO — Chat 文件的特化接口

```typescript
// @file common/interfaces/IChatFileIO.ts

import { IFileIO } from './IFileIO';
import type { ChatManifest, ChatNode } from '@itookit/llm-engine';

/**
 * Chat 文件 I/O 接口
 *
 * Chat 文件的特殊之处：
 *  - 主体内容是一个 ChatManifest（JSON）
 *  - assetdir 内存储的是 ChatNode 消息文件 + settings.yaml + 用户上传的附件
 *  - 需要分支导航、消息链遍历等结构化操作
 */
export interface IChatFileIO extends IFileIO {
    // ========== Manifest ==========
    getManifest(): Promise<ChatManifest>;
    updateManifest(patch: Partial<ChatManifest>): Promise<void>;

    // ========== 消息（ChatNode）操作 ==========
    /**
     * 在 assetdir 中写入一条 ChatNode 消息
     * @param nodeId 消息节点 ID（如 "000_00003_u"）
     * @param node ChatNode 数据
     */
    writeMessage(nodeId: string, node: ChatNode): Promise<void>;

    /**
     * 从 assetdir 读取一条 ChatNode 消息
     */
    readMessage(nodeId: string): Promise<ChatNode | null>;

    /**
     * 软删除消息及其所有后代
     */
    deleteMessage(nodeId: string): Promise<void>;

    /**
     * 更新消息（部分更新）
     */
    updateMessage(nodeId: string, updates: Partial<ChatNode>): Promise<void>;

    /**
     * 沿 parent_id 链遍历，构建消息上下文
     * @param fromNodeId 起始节点 ID
     * @returns 从根到 fromNodeId 的 ChatNode 数组（正向）
     */
    walkMessageChain(fromNodeId: string): Promise<ChatNode[]>;

    /**
     * 读取节点的兄弟节点（用于分支切换）
     */
    getSiblings(nodeId: string): Promise<ChatNode[]>;

    // ========== 分支 ==========
    /** 创建分支 */
    createBranch(name: string, fromNodeId: string): Promise<void>;
    /** 切换当前分支 */
    switchBranch(name: string): Promise<void>;
    /** 获取分支树 */
    getBranchTree(): Promise<BranchTreeNode>;
    /** 获取当前分支名称 */
    getCurrentBranch(): Promise<string>;

    // ========== 用户资产（区别于 ChatNode 消息文件） ==========
    /**
     * 上传用户附件到 assetdir
     * 与 writeMessage 不同，这些是可以被用户引用的文件（图片、文档等）
     */
    putUserAsset(name: string, content: ArrayBuffer): Promise<string>;

    /**
     * 列出用户上传的资产（排除 .chat 消息文件和 settings.yaml）
     */
    listUserAssets(): Promise<string[]>;

    // ========== Settings ==========
    getSettings(): Promise<ChatSessionSettings>;
    saveSettings(settings: ChatSessionSettings): Promise<void>;
}
```

## 工厂函数签名

```typescript
// @file common/interfaces/IFileIOFactory.ts

import { ISessionEngine } from './ISessionEngine';
import { IFileIO } from './IFileIO';
import { IMDFileIO } from './IMDFileIO';
import { IChatFileIO } from './IChatFileIO';

/** 创建泛用文件句柄 */
export function createFileIO(engine: ISessionEngine, nodeId: string): IFileIO;

/** 创建 MDX 文件句柄 */
export function createMDFileIO(engine: ISessionEngine, nodeId: string): IMDFileIO;

/** 创建 Chat 文件句柄 */
export function createChatFileIO(engine: ISessionEngine, nodeId: string): IChatFileIO;
```

## 实现位置

| 接口 | 定义位置 | 实现位置 |
|------|----------|----------|
| `IFileIO` | `common/interfaces/IFileIO.ts` | `vfslib/src/file-io/FileIO.ts` (实现基类) |
| `IMDFileIO` | `common/interfaces/IMDFileIO.ts` | `mdx/src/file-io/MDFileIO.ts` (扩展基类) |
| `IChatFileIO` | `common/interfaces/IChatFileIO.ts` | `llm-engine/src/file-io/ChatFileIO.ts` (扩展基类) |

## 消费者的变化

### 变更前（MDX AssetResolverPlugin）

```typescript
// 3 步操作才能列资产
const dirId = await engine.getAssetDirectoryId(ownerNodeId);
if (!dirId) return;
const nodes = await engine.getChildren(dirId);
// 手动扫描 @asset/ 引用
const regex = /@asset\/([^\s)"']+)/g;
```

### 变更后

```typescript
// 1 步
const assets = await fileIO.listAssets();
// 格式特有方法
const refs = fileIO.extractReferencedAssets(content);
```

### 变更前（Chat SessionEngine）

```typescript
const assetDir = this.getAssetDirPath(nodeId);
const node = await this.readJson<ChatNode>(`${assetDir}/${nodeId}.chat`);
```

### 变更后

```typescript
const msg = await chatFileIO.readMessage(messageNodeId);
```

## 与现有接口的关系

```
ISessionEngine 不会被移除 — 它仍然是 VFS 操作的基础接口。

IFileIO 是对 ISessionEngine 的高层包装：
  - ISessionEngine:          细粒度 VFS 操作（文件/目录 CRUD、搜索、事件）
  - IFileIO:                 以文件为单位的整体操作（文件+assetdir 一体）
  - IMDFileIO / IChatFileIO: 格式特定的高层操作（引用解析、消息遍历、分支管理）

三者共存，上层逐步从直接使用 ISessionEngine 迁移到使用 IFileIO。
```

## 迁移路径

| 阶段 | 内容 | 风险 |
|------|------|------|
| Phase 1 | 在 `common` 中定义 `IFileIO` 接口 | 零风险 |
| Phase 2 | 在 `vfslib` 中实现 `FileIO` 基类（包装 `ISessionEngine`） | 低 |
| Phase 3 | MDX 的 `AssetResolverPlugin` 改用 `IMDFileIO` | 中 |
| Phase 4 | `llm-engine` 内部 `LLMSessionEngine` 暴露 `IChatFileIO` | 中 |
| Phase 5 | `llm-ui` 的 `AssetService` 改用 `IChatFileIO` | 中 |

## 收益总结

| 维度 | 收益 |
|------|------|
| **消除重复** | `@asset/` 扫描、三步读取模式、pruneAssets 三处相同逻辑统一到 `IFileIO`/`IMDFileIO` |
| **语义清晰** | `fileIO.putAsset()` 比 `engine.createAsset(ownerNodeId, ...)` 更明确表达"文件拥有资产" |
| **类型安全** | MDX 拿到 `IMDFileIO` 就不可能误调用 Chat 方法，反之亦然 |
| **可测试性** | Mock 一个 `IFileIO` 比 Mock 整个 `ISessionEngine` + VFS 链简单得多 |
| **不破坏现有架构** | `ISessionEngine` 保留，`IFileIO` 是上层包装，渐进式迁移 |
