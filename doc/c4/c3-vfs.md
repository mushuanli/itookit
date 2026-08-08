# C3 - VFS 子系统组件图

## 层次结构

```
IStorageBackend  (path-based: Memory / IndexedDB / SQLite+FS)
    ↕
VFSEngine  —  AccessController, EventBus, PluginPipeline, resolveStore/mapToSystemNode
    ↕
VFSManager (implements IVFSManager)  —  module lifecycle coordinator
    ↕
ModuleFS (implements IModuleFS + IFSDriver)  —  chroot-isolated view per module
    |
    ├── driver: IFSDriver           — CRUD + transaction (self = this)
    ├── meta: IFSMetaDriver         — assets / tags / seq / refs
    └── openFile(nodeId) → IFile    — FileHandle / MDXFileHandle / ChatFileHandle
                                      └── asset(name) → AssetObj
```

## VFS 核心组件

| 组件 | 文件 | 职责 |
|---|---|---|
| `VFSEngine` | `stdio/src/engine/` | 路径解析、存储后端映射、访问控制 |
| `AccessController` | `stdio/src/engine/` | 点号文件权限 (isSystem 模块可写入) |
| `PluginPipeline` | `stdio/src/engine/` | 操作前/后插件钩子 |
| `DeviceRegistry` | `stdio/src/engine/` | /dev/ 设备注册与管理 |
| `VFSManager` | `stdio/src/services/` | 模块生命周期协调 |
| `ConfigService` | `stdio/src/services/` | VFS 配置读取 |
| `ModuleFS` | `stdio/src/services/` | 模块级 chroot 隔离文件系统 |
| `FileHandle` | `stdio/src/file-io/` | 基本文件句柄 (IFile) |
| `MDXFileHandle` | `stdio/src/file-io/` | MDX 文件句柄 (IMDXFile) |
| `ChatFileHandle` | `stdio/src/file-io/` | 聊天文件句柄 (IChatFile) |
| `AssetObj` | `stdio/src/file-io/` | 资产目录内子文件句柄 |

## 存储驱动

| 驱动 | 包 | 适用环境 |
|---|---|---|
| `MemoryBackend` | stdio (内置) | 测试/内存存储 |
| `IndexedDBBackend` | vfsdriver-indexeddb | 浏览器 |
| `LocalFSBackend` | vfsdriver-localfs | Node.js/Electron |

## VFS 目录约定

```
/                     系统根
├── etc/              系统配置模块 (CONFIG_MODULE)
│   └── llm/
│       ├── .connections/    LLM 连接配置
│       ├── .mcp/            MCP 配置
│       └── .skills/         Skill 定义
├── dev/               设备目录
│   └── llm/           LLM 设备 IOCTL
└── module/            用户模块挂载点
    ├── chats/         对话模块 (.chat 文件)
    ├── notes/         笔记模块
    ├── missions/      Mission 编排模块
    └── ...            其他工作区模块
```
