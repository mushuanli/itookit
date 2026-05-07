Build tools by package type:
- Logic-only packages (`common`, `vfslib`, `device-llm`, `llm-kernel`, `llm-engine`, `tools`, vfsdrivers): **tsup** → CJS+ESM + `.d.ts`
- UI packages (`memory-manager`, `vfs-ui`, `llm-ui`, `mdx`, `app-settings`): **vite build**

## VFS 核心分层

```
IStorageBackend  (IndexedDB / SQLite+FS)     ← 存储后端
    ↕
VFSEngine  (路径解析 / 权限 / 事件 / 插件管道)  ← 引擎核心
    ↕
VFSManager (IVFSManager)  — 模块生命周期协调器
    ↕
ModuleFS (IModuleFS)  — 模块级 chroot 文件系统
    ├── IFSDriver      — POSIX CRUD + 事务 + 搜索
    ├── IFSMetaDriver  — 资产 / 标签 / SeqFile / 引用 / 监听
    └── IFile          — 文件句柄 (FileHandle / MDXFileHandle / ChatFileHandle)
```

所有接口定义在 `packages/common/src/interfaces/fs/`，调用方只依赖接口，不依赖实现。

## 关键文档

| 文档 | 内容 |
|---|---|
| [目录结构](./doc/pkgstructure.md) | 所有 package 及职责 |
| [架构设计](./doc/architecture.md) | 系统全貌 — VFS / LLM / Agent / Skill / Mission / Session |
| [VFS 设计](./doc/design/VFS-design.md) | VFS 详细设计 — 存储 / 引擎 / 挂载 / 权限 / 事件 / 资产 |
| [VFS-UI 设计](./doc/vfsui-design.md) | 文件树 UI 组件设计（部分过期，接口引用以 architecture.md 为准） |
