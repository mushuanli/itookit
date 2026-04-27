# CLAUDE.md — @itookit/app-settings

设置模块。管理全局配置、日志、存储、标签、数据恢复和系统 VFS 浏览。

peerDependencies: `@itookit/common`, `@itookit/device-llm`, `@itookit/llm-engine`, `@itookit/llm-ui`, `@itookit/memory-manager`

## Commands

```bash
pnpm --filter @itookit/app-settings build   # vite build
pnpm --filter @itookit/app-settings dev     # vite dev
```

## Architecture

```
src/
├── index.ts               ← createSettingsModule() + 导出
├── services/
│   ├── SettingsService.ts  ← 设置 CRUD (VFS ConfigService 持久化)
│   ├── SnapshotService.ts  ← 配置快照 (备份/恢复)
│   └── SyncService.ts      ← 配置同步
├── engine/
│   ├── SettingsEngine.ts   ← ISessionEngine 适配器 (设置页)
│   ├── SkillsEngine.ts     ← ISessionEngine 适配器 (Skill 列表)
│   └── SystemVFSEngine.ts  ← 原始 VFS 浏览器引擎
├── editors/                ← Settings 编辑器 (实现 ISettingsWidget)
│   ├── AboutSettingsEditor.ts
│   ├── ContactSettingsEditor.ts
│   ├── LogSettingsEditor.ts        ← 日志级别 + 查看器
│   ├── RecoverySettingsEditor.ts   ← 数据恢复
│   ├── StorageSettingsEditor.ts    ← 存储概览/迁移/快照/同步/危险区
│   ├── TagSettingsEditor.ts        ← 全局标签管理
│   └── SystemFSExploreEditor.ts    ← 原始 VFS 浏览 (调试)
├── factories/
│   └── settingsFactory.ts  ← createSettingsFactory()
├── types/
│   └── types.ts           ← SyncMeta, SyncJob, SnapshotMeta...
└── styles/
```

## 核心组件

### createSettingsModule()

```typescript
const { service, engine } = await createSettingsModule(vfs: IVFSManager);
// service: SettingsService
// engine: SettingsEngine (ISessionEngine)
```

### SettingsEngine

将 `SettingsService` 适配为 `ISessionEngine`，使设置页面可以通过 `VFSUIShell` 展示。

### SkillsEngine

将 `IAgentManagementService.getSkills()` 返回的技能列表适配为 `ISessionEngine`，技能显示规则：
- `node.name` = Skill 名称
- `node.content` = `"{id}  {typeIcon}"` (summary)
- `node.metadata.tags` = `['disabled']` (禁用时)
- `node.metadata.hasUnreadUpdate` = `enabled` (绿点)

### Settings 编辑器一览

| 编辑器 | 功能 |
|---|---|
| `StorageSettingsEditor` | VFS 容量使用、数据迁移、快照管理、同步设置、危险操作 |
| `LogSettingsEditor` | 日志级别配置、概览统计、日志查看器 |
| `RecoverySettingsEditor` | 从备份/快照恢复数据 |
| `TagSettingsEditor` | 全局标签颜色/名称管理 |
| `SystemFSExploreEditor` | 原始 VFS 树浏览 (含隐藏文件/资产目录，调试用) |
| `AboutSettingsEditor` | 版本信息 |

### createSettingsFactory()

```typescript
const factory = createSettingsFactory(
    service: SettingsService,
    agentService: IAgentConfigService,
    llmDriver: IDeviceDriver,
): EditorFactory;
```

## Conventions

- Settings 数据持久化通过 `ConfigService`（底层写入 VFS `__config/` 目录）
- `ISettingsWidget` 继承 `HTMLElement` — 每个编辑器是一个 Web Component
- `StorageSettingsEditor` 的子 section 各实现独立的 `ISettingsWidget`：`StorageOverviewSection`, `MigrationSection`, `SnapshotSection`, `SyncSection`, `DangerZoneSection`
