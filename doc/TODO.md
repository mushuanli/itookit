## ✅ RESOLVED (v4.0)

**P1: IModuleFS/IFSDriver 重复** — IModuleFS 现在是薄包装器，只暴露 `driver`, `meta`, `openFile`, `init`, `dispose` 及 VFS 特有设备方法。所有 CRUD 统一通过 `fs.driver.*`。
- `IFSTransaction` 已删除（与 `IFSDriverTransaction` 统一）
- `FSCapabilities.transaction` 已删除（`IFSDriver.transaction()` 现为必选方法）
- `FSDriverAdapter` 已删除（ModuleFS 直接实现 IFSDriver，self-reference `this.driver = this`）

**VFSSearchQuery 重复** — 改为 `extends FSSearchQuery { modules?: string[] }`

**IModuleFS compat 别名** — 已删除 `assets?`, `tags?`, `seq?`, `refs?`, `watcher?`，统一使用 `fs.meta.*`

**ListOptions/TreeWalkOptions 重复字段** — 提取为 `VisibilityOptions` 基接口

**IFSEngine/SRSItemData** — `SRSItemData` 重导出源已修正到 `srs/ISRSService`，`IFSEngine` 文件全面加注 `@deprecated`

---

## 🟡 已知设计权衡（非错误）

**两种事件系统**（FSEventPayloadMap vs VFSManagerEventPayloadMap）: payload 结构不同（细粒度 FS 事件 vs 跨模块 Manager 事件），属于合理分层，非重复。

**FSCapabilities 字段不合并**（symlinks ≠ hardlinks, partialRead ≠ partialWrite, search ≠ semanticSearch）: 有独立语义，合并会丢失信息。

---

## pending

- 增加 call AI 功能，
- agent config时复制当前选中agent为模版功能
- 生成应用 Quasar Tauri ?
    - 增加文件系统支持功能，用于生成应用
- 多媒体功能
- agent 编排功能


verifying:
- 增加数据库增量导入功能
- mdx附件 - 增加上传按钮
- llm附件 - ui部分完成， 但是engine部分需要验证。
- sync 和增量同步功能
    - vfs: 增加 sync 模块
    - vfsd: 实现增量 sync 功能

pending:
1. branch功能，