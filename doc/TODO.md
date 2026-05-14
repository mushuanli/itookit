## ✅ RESOLVED (v4.0 → v4.1)

### v4.0
- **P1: IModuleFS/IFSDriver 重复** — IModuleFS 薄包装器
- `IFSTransaction` + `FSDriverAdapter` + `FSCapabilities.transaction` 删除
- **VFSSearchQuery** → `extends FSSearchQuery`
- **IModuleFS compat 别名** → 统一 `fs.meta.*`
- **VisibilityOptions** 提取
- **SRSItemData** 导出源修正

### v4.1
- **IStorageBackend path-based** — 废弃 IInodeStore/IMetaStore/IContentStore 三层分离
- **PathResolver / node-mapper / tree-ops** — 删除（3 文件，310 行）
- **LocalFS backend** — path_ino 表删除，3 store 文件 → 1 backend（470 行删）
- **IndexedDB backend** — 5 IDB store → 3，3 文件删除
- **AssetObj** — IFile 新增 `asset(name): AssetObj`，统一 readInternal/putAsset 等
- **IFile** — 方法数从 20 → 12

---

## 🟡 已知设计权衡

**两种事件系统** — 合理分层。**FSCapabilities 字段** — 有独立语义。

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