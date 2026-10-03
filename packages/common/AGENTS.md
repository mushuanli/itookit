# @itookit/common 开发说明

共享接口、类型、工具和 i18n。运行时包通过这里的协议解耦。

`src/` 分五组：`events/`（导航事件）、`i18n/`（`t()`/`setLocale`、zh-CN 与 en 资源、图标表）、`interfaces/`、`types/`、`utils/`。

## LLM 兼容导出

原 llm-common 已删除。本包通过 `src/llm-compat.ts` 直接转发原有 285 个具名导出，保留既有调用方兼容性。新代码从契约所属模块导入：driver-llm/contracts、llm-context、tools/contracts、tools/mcp-contracts、llm-tasks/contracts、llm-flow/contracts 或 llm-session/contracts。

这仍是聚合兼容层，依赖上述能力包；删除 llm-common 不代表 common 已完全解除 LLM 依赖。不得在兼容文件增加新的协议定义或业务实现。

## VFS 核心协议（@itookit/vfs-core）

VFS 协议与事件总线在 `@itookit/vfs-core`（`src/interfaces/` + `src/eventbus/`）：

| 层级 | 接口（位于 vfs-core） |
| --- | --- |
| 存储 | `IStorageBackend` |
| 系统管理 | `IVFSManager` |
| 文件系统视图 | `IFileSystem` |
| 驱动 | `IFileSystemDriver`（= `IFSDriver`）、`IFSMetaDriver` |
| 文件 | `IFile`、`AssetObj` |

## 命令

```bash
pnpm --filter @itookit/common build       # tsup
pnpm --filter @itookit/common typecheck
```

## 约束

- 新增跨包 LLM 协议定义在对应能力模块，VFS 协议定义在 `@itookit/vfs-core`，本包不再新增协议。
- 接口优先使用 `interface`，判别联合使用 `type`。
- 公共协议不得 import 上层包。
- 不在本包实现 Kernel、Session Service 或 UI Projection。
- 新增 i18n key 时同步更新中英文资源（`src/i18n/zh-CN.ts` → `en.ts`）。

相关文档：[架构设计](../../doc/architecture.md)、[接口契约](../../doc/interface-contracts.md)
