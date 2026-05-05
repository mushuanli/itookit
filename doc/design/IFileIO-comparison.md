# IFileIO 新旧实现对比分析

## 变更规模

| 变更类型 | 文件 | 行数 |
|----------|------|------|
| 新增 | `common/src/interfaces/IFileIO.ts` | +54 |
| 新增 | `common/src/interfaces/IMDXFileIO.ts` | +39 |
| 新增 | `common/src/interfaces/IChatFileIO.ts` | +58 |
| 新增 | `common/src/interfaces/chat.ts` | +179 |
| 新增 | `vfslib/src/file-io/FileIO.ts` | +176 |
| 新增 | `vfslib/src/file-io/MDXFileIO.ts` | +83 |
| 新增 | `vfslib/src/file-io/ChatFileIO.ts` | +247 |
| 缩减 | `mdx/.../asset-resolver.plugin.ts` | -114 |
| 缩减 | `llm-engine/.../persistence/types.ts` | -228 |
| **净增** | | **~494 行** |

## 优点

### 1. 消除三处重复的 assetdir 操作模式

| 操作 | 旧实现 | 新实现 |
|------|--------|--------|
| Asset 列表获取 | 3 处各自实现 `getDirId → getChildren → Map` | FileIO 基类一次实现，子类继承 |
| Asset 写入 | 3 处各自调用 `engine.createAsset` | FileIO.putAsset() 带索引增量更新 |
| 引用路径拼接 | 3 处各自 `\`@asset/${name}\`` | FileIO.putAsset() 返回统一格式 |
| 未引用清理 | 2 处各自实现正则扫描+删除 | IFileIO.pruneAssets() 统一实现 |
| Blob URL 管理 | AssetResolverPlugin 手动管理 Set | MDXFileIO 统一管理 Map |

### 2. 类型下沉，打破不必要的依赖

```
旧：tools → llm-engine → ChatManifest/ChatNode 类型
新：tools → common → ChatManifest/ChatNode 类型
```

`llm-engine` 不再是 chat 数据格式的唯一权威——格式定义在 `common`，`vfslib` 提供标准实现，`llm-engine` 消费它。

### 3. 接口隔离，职责清晰

| 类 | 旧职责 | 新职责 |
|----|--------|--------|
| `LLMSessionEngine` (1747行) | VFS操作 + assetdir路径拼接 + ChatNode序列化 + 分支管理 + 设置YAML + 锁管理 + 流式节流 | 保留锁管理 + 流式节流 + 执行调度；ChatNode序列化、分支管理委托给 ChatFileIO |
| `AssetResolverPlugin` (89行→~30行) | asset缓存管理 + Blob URL创建/销毁 + DOM遍历 + 引用扫描 + 清理 | 仅 DOM 遍历 + 属性替换 |
| `AssetService` | 透传 engine 方法 + 手写 @asset/ 引用拼接 | 透传 FileIO 方法 |

### 4. 缓存策略内聚

旧实现中，assetdir 缓存分散在各消费者中：
- AssetResolverPlugin: 5s TTL 缓存
- LLMSessionEngine: 永久缓存 `assetDirPaths` Map
- AssetManagerUI: 无缓存，每次重新 fetch

新实现：FileIO 实例级缓存（`_assetDirId` + `_assetIndex`），生命周期与文件句柄绑定，所有操作共享。

### 5. 可测试性

```typescript
// 旧：测试 AssetResolverPlugin 需要 mock ISessionEngine + 多个方法
mockEngine.getAssetDirectoryId.mockResolvedValue('dir-1');
mockEngine.getChildren.mockResolvedValue([...]);
mockEngine.readContent.mockResolvedValue(arrayBuffer);

// 新：测试时只需 mock IChatFileIO
mockFileIO.getManifest.mockResolvedValue({ ... });
mockFileIO.walkMessageChain.mockResolvedValue([...]);
```

## 缺点

### 1. 新增 3 层接口 + 3 个类的理解成本

开发者需要理解 `IFileIO → IMDXFileIO` / `IFileIO → IChatFileIO` 的继承层次，以及 `FileIO → MDXFileIO` / `FileIO → ChatFileIO` 的实现层次。

**缓解**：继承深度只有 1 层，接口方法语义直观（`read`/`write`/`putAsset`/`getAsset`）。

### 2. FileIO 实例生命周期管理

FileIO 实例持有缓存（`_assetIndex`），如果底层 VFS 数据被外部修改（例如另一个 FileIO 实例写入了新 asset），缓存会过期。

**缓解**：FileIO 设计为短生命周期（一次编辑会话），销毁时自然失效。如需跨实例一致性，可调用 `engine.on('node:created', ...)` 监听事件。

### 3. ChatFileIO 性能：分支树构建全量遍历

`getBranchTree()` 会递归读取所有 ChatNode 来构建树，对于深层嵌套的聊天记录可能有性能问题。

**缓解**：这是旧代码 `LLMSessionEngine.getBranchTree()` 本身就有的问题，非新引入。ChatFileIO 的实现与旧逻辑等价，只是独立出来了。

### 4. common 包膨胀

`common` 本应是轻量类型包，现在加入了 179 行的 `chat.ts`（ChatManifest, ChatNode, ChatNodeMeta, AppendMessageMeta 等）。

**评估**：可以接受。chat 类型是纯数据结构（零运行时依赖），符合 common 的定位。从 llm-engine 移到 common 净效果是减少了高阶包的依赖。

### 5. 迁移期间新旧代码共存

`LLMSessionEngine` 不能立即删除 ChatNode 操作——它需要逐步迁移到使用 `ChatFileIO`。新旧代码共存期会增加维护负担。

**缓解**：ChatFileIO 已实现所有 ChatNode 操作，LLMSessionEngine 可以逐方法迁移。

## 总体评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 消除重复 | ★★★★★ | 三处 assetdir 操作合并为一级实现 |
| 接口清晰度 | ★★★★☆ | 文件+assetdir 整体语义明确 |
| 依赖解耦 | ★★★★☆ | chat 类型下沉，tools 可独立读 .chat 文件 |
| 迁移成本 | ★★★☆☆ | LLMSessionEngine 需逐方法适配 |
| 性能影响 | ★★★★★ | 无退化，缓存策略更优 |
| 增加复杂度 | ★★★☆☆ | 3 接口+3 类，继承深度 1 层 |

## 建议

1. **接口层已就绪** — 当前实现是合理的，可以合并
2. **优先完成 MDX 迁移** — AssetResolverPlugin 已经适配，观察稳定性
3. **LLMSessionEngine 逐步迁移** — 先让 ChatFileIO 与 SessionEngine 共存，逐方法替换
4. **考虑 Lazy 分支树** — `getBranchTree()` 可以改为惰性加载子节点，避免全量遍历
