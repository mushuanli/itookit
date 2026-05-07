# CLAUDE.md — @itookit/common

共享接口、类型、工具函数和 i18n 的基础包。**零运行时依赖**，所有 `@itookit/*` 包的类型源头。

## Architecture

此包**不包含实现逻辑**，只导出 interfaces / types / utils / components / i18n。

```
src/
├── index.ts              ← 统一导出入口
├── interfaces/           ← 接口定义
│   ├── fs/               ← VFS 核心接口
│   │   ├── services/
│   │   │   ├── fs-driver.ts      ← IFSDriver + IFSDriverTransaction (v3.3)
│   │   │   ├── fs-meta-driver.ts ← IFSMetaDriver (v3.3)
│   │   │   ├── module-fs.ts      ← IModuleFS + IFSTransaction
│   │   │   ├── vfs-manager.ts    ← IVFSManager
│   │   │   ├── config-service.ts ← IConfigService
│   │   │   └── factory.ts        ← VFSFactory
│   │   ├── core/         ← FSNode, FSEvent, FSError, Options
│   │   ├── storage/      ← IStorageBackend + 3层 Store + 3可选增强
│   │   ├── capabilities/ ← IAssetOperations, ITagOperations, ISeqFileOperations, IRefOperations, IWatchOperations
│   │   ├── device/       ← IDeviceDriver, IDeviceHandle
│   │   ├── mount/        ← IMountRouter, MountPoint
│   │   ├── plugin/       ← IPlugin, IPluginManager
│   │   └── sync/         ← ISyncService
│   ├── IFSEngine.ts      ← @deprecated v3.3, 用 IModuleFS/IFSDriver 替代
│   ├── IFile.ts          ← IFile (v3.3: 依赖 FSNode/FSEventType, 不再依赖 IFSEngine)
│   ├── IMDXFile.ts       ← extends IFile
│   ├── IChatFile.ts      ← extends IFile
│   └── IEditor.ts        ← sessionEngine?: IModuleFS (v3.3)
├── utils/                ← 工具函数
├── components/           ← 基础 UI 组件
├── i18n/                 ← zh-CN.ts / en.ts / icons.ts / t()
├── events/               ← 导航事件常量
└── types/                ← 杂项类型
```

接口详情: [接口目录](./interface-catalog.md)

## v3.3 VFS 接口分层

| 接口 | 层级 | 说明 |
|---|---|---|
| `IStorageBackend` | 存储 | 3层 Store (inode/meta/content) |
| `IVFSManager` | 系统管理 | 模块生命周期、跨模块搜索 |
| `IModuleFS` | 模块 | chroot 隔离、`driver` + `meta` + `openFile()` |
| `IFSDriver` | 驱动 | POSIX CRUD + 事务(必选) + 链接(必选) + 搜索 |
| `IFSMetaDriver` | 驱动 | assets/tags + seq?/refs?/watcher? |
| `IFile` | 文件句柄 | 组合 IFSDriver + IFSMetaDriver |

调用方始终以接口为类型，具体装配只在 `app-shell/bootstrap.ts` 中。

## Conventions

- **所有 cross-package 类型必须定义在此包**，其他包通过 `import type { X } from '@itookit/common'` 引用
- 接口用 `interface`（非 `type`），以支持 declaration merging
- 错误类统一继承 `FSError`
- i18n 添加字符串：先在 `zh-CN.ts` 加 key，再在 `en.ts` 加对应翻译
- 图标从 `icons.ts` 导入，**禁止**在组件中硬编码 emoji
- `FSNode` 是 discriminated union — 使用前先 type-narrow（检查 `type` 字段）
- **废弃 `IFSEngine`**，新代码使用 `IModuleFS` 或 `IFSDriver`
