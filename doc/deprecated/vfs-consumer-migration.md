# VFS 消费端迁移与兼容方案

> ⚠️ 已归档：本迁移提案已作废（`Legacy*Adapter` 从未落地）。当前实现状态见 `../design/vfs-implementation-status.md`。

> 2026-09-07 最终决策：旧数据和旧表结构直接作废，无迁移/兼容入口；Session 数据是 session.seq、history.seq、attachments、kernel，运行时投影 /history 和 /attachments。下文历史迁移提案不再执行。
> 历史方案：本文保留演进依据，不再作为当前接口规范。最新目标、旧入口删除范围与验收以 [C4 设计审查](vfs-c4-review.md) 为准；其中单用户每 Session 一条挂载配置取代独立 namespace/binding/grant/export 四套主记录，不再保留 moduleFS/customEngine 源码兼容入口。实际实现状态见 [实现进度](vfs-implementation-status.md)。

状态：历史方案，已由上述最终决策取代；下文的旧迁移步骤和接口草案不作为当前待办。2026-09-08 核对：当前实现及未完成验收见 [实现进度](vfs-implementation-status.md)，当前接口见 [C4 设计审查](vfs-c4-review.md)。

本文补充 [VFS 重构方案](vfs-namespace-refactor.md)，规定 app-shell、llm-ui 及相关依赖的迁移。沿用单用户 admin、MindOS 根、持久 Session 数据归 `/var/lib/sessions/<id>`、全局状态归 `/var/lib/kernel` 的决策。系统目录全量读写范围仍是待确认项，本文按受控投影设计。

## 1. “兼容”需要分层定义

| 兼容对象 | 建议承诺 | 不应继续兼容的行为 |
| --- | --- | --- |
| 文件操作 | 保留 CRUD、IFile/AssetObj、Round 内容结构；用受限适配器连接新旧接口 | basename 全局搜索、内部 `/module` 路径绕过、无权限检查 fallback |
| 应用源码 | 过渡期保留 moduleFS/customEngine 等输入，入口归一化后使用新接口 | `as IModuleFS` 强转异构视图、虚构 moduleId 后向 manager 取源 |
| Session 身份 | 保留 Session/Task/Round/branch ID 和既有业务事件 | 将文件路径当作 durable Session ID，或迁移后重新生成会话 |
| 旧数据 | `.chat` manifest、Round DAG、profile、资产、`.kernel` 可完整迁移 | 双写旧资产和新 Session 目录；打开旧文件时自动重建覆盖新状态 |
| 路由/书签 | 已知旧资源可经显式定位表解析到 Session 或新文件路径 | 搜所有模块找同名文件；把未经授权的 namespaceId 当能力 |
| 旧程序回退 | 切换前旧存储保持权威；失败可重试迁移 | 切换后继续启动不认识新 schema 的旧程序写旧目录 |

这里不是“所有实现完全向后兼容”。接口适配能覆盖普通文件消费者；会话身份、路由与持久存储变化必须迁移业务调用方。新 schema 的最低可写版本要在启动时验证，避免旧程序产生两套历史。

兼容桥应有明确方向：

- `LegacyModuleSourceAdapter`：把已明确授权的旧模块目录接入新来源能力，补齐全部权限/metadata/事件边界。不能仅返回旧 IModuleFS。
- `LegacyEditorOptionsAdapter`：仅在 UI 边界把 `{ moduleFS, nodeId, ownerNodeId }` 转为文件目标及受限文件/资产上下文；新旧字段同时存在但不一致时报错。
- `LegacyChatLocator`：可信迁移表将旧 `{ moduleName, path }` 解析为 sessionId；rename 更新旧别名，不改变身份。不存在或歧义明确失败，不创建新 Session。
- 旧单来源调用需要 `transaction(fn)` 时，wrapper 显式绑定一个事务根；异构视图不能假装提供原全局事务。

## 2. 首先拆开三个“ID”

`app-shell/core/Workbench.ts` 的 getActiveSessionId 实际返回 VFS UI 选中的文件路径；`SESSION_SELECT` 同样以路径作为 sessionId。`llm-ui` 的 currentSessionId 是 durable Session ID；HistoryView 内部分 nodeId 又是消息/Round 投影 ID。不能全仓把 nodeId 替换成 path。

建议在 common/ui-common 增加明确目标类型：

```ts
// 设计声明；文件目标的 scope 引用必须由 host 验证并重新 acquire。
type EditorTarget =
  | { kind: 'file'; scope: FileScopeRef; path: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'entity'; entityType: 'agent' | 'skill' | 'flow'; id: string };
type FileScopeRef =
  | { kind: 'session'; sessionId: string }
  | { kind: 'namespace'; namespaceId: string };

interface EditorFileContext {
  readonly fs: IFileSystem;
  readonly cwd: string;
  readonly ownerPath?: string; // 普通复合文件的附件 owner
}
interface SessionAssetContext {
  read(name: string): Promise<Blob | null>;
  put(name: string, data: Blob): Promise<void>;
  list(): Promise<Array<{ name: string; mimeType?: string; size?: number }>>;
  remove(name: string): Promise<void>;
}
```

EditorTarget 的 namespaceId 是持久定位信息，运行时 viewId 用于缓存隔离，revision 用于失效判断，不写死成可长期恢复的 view 实例。临时 AppView 无持久 scope 时，路由只在当前实例有效；要支持重启恢复必须持久化组合 namespace。

普通编辑器使用 file target 和文件 owner；聊天编辑器使用 session target、Session 文件上下文和 SessionAssetContext。SessionAssetContext 是同一 VFS 附件能力的业务适配，不能创建另一套存储，也不能给聊天渲染器原始 `/var/lib` 写权限。Round/message/flow-node ID 保留各自原义。

## 3. packages/app-shell 的修改

| 实际位置 | 当前耦合 | 目标修改 |
| --- | --- | --- |
| `bootstrap.ts` | `ChatEngine(vfs)`；kernel catalog 用 `getEngine(FS_MODULE_CHAT)`；ChatKernelStorageResolver | 启动打开 MindOS 根，构建私有系统 storage 和 Session repository，按稳定 ID 解析新目录；kernel 不等待 `.chat` 文件装载 |
| `bootstrap.ts` | recover 后才给 `kernel.toolDriver` 设置全局 vfsResourcePort | 注册 per-session files factory 和执行能力后再 recover；每个 Session scope 独立注入，移除全局搜索 resolver |
| `bootstrap.ts` HITL bridge | session runtime → nodeId → 文件项 waiting 标记 | Session 列表按 sessionId 显示 Task/HITL 状态；旧 `.chat` 引用项可由 alias 映射显示提示 |
| `types.ts` AppOptions/WorkspaceConfig | backend、additionalMounts、moduleName 决定 workspace 存储 | 将来源注册与 workspace 展示分离：workspace 选择已授权 scope/Session list，不再创建同名 storage module |
| `types.ts` WorkbenchConfig | vfs+moduleName 或 customEngine | 新入口接收 FileContextOwner；legacy 输入经 adapter 归一化，避免 Workbench 自行向 manager 取权 |
| `strategies/types.ts`、`strategies/index.ts` | strategy.getEngine(moduleName) | 文件策略异步 acquire 文件 context；chat 策略提供 Session 列表及编辑器；agent/skill/flow 使用业务实体数据源 |
| `core/Workbench.ts` | 文件树、SESSION_SELECT、EditorOptions.moduleFS；start 调 engine.init | 文件 Workbench 用 IFileSystem，初始化/释放由 owner 管理；getActiveSessionId 改 getActiveTarget 或 getActiveFilePath |
| `core/Workbench.ts` | sharedHostContext.saveContent 对 nodeId 直接 writeContent | 只为文件 target 提供文件保存；聊天内容通过对话命令保存，不调用原始记录写入 |
| `core/Workbench.ts` mention、导航 | resourceId 只有路径，没有来源上下文 | mention 返回带 scope 的 file target，导航保留 Session/file/entity 类型 |
| `ThemeService.ts` 与 settings 组装 | etc module 偏好读取/写入 | 注入可信配置服务；用户主题可迁至 `/home/admin/.config`，不得把全部配置管理权交给 Task |
| AppHandle | navigate(slug, resourceId)、vfs manager 全量暴露 | 新增类型化 navigate(target)，旧形式走兼容 resolver；host 管理能力与应用 handle 分开注入 |

推荐拆为 FileWorkbench 与 ConversationWorkbench，复用布局/编辑器宿主，分别消费文件树和 Session catalog。可以在一个 Workbench 中用判别联合实现，不必强制新建两个包。不要为了复用文件树而将 session.json 或 kernel 目录当作可编辑聊天文件。

启动顺序：平台打开 MindOS 来源 → 检查 schema/执行迁移 → 建立 kernel 私有存储 → initialize kernel（尚不调度）→ 初始化 namespace/grant/export 与系统 profile → 注册 Session 工具 factory 和执行隔离 → 恢复未完成撤权/fencing → recover kernel → 装配 UI。UI 打开会话只 attach，不能成为恢复后台 Task 的必要步骤。

当前 registry 缓存多个 scope，但 bootstrap 对 legacy toolDriver 的一次 setVFSContext 不等于所有 Session scope 已注入，迁移必须用实际工具执行验证。

## 4. packages/llm-ui 的修改

| 实际位置 | 必须修改 | 可保留 |
| --- | --- | --- |
| `src/index.ts` createLLMFactory | 没有 nodeId 时不再 createFile；使用 Session create/open；pendingCreations 按实例+sessionId 隔离 | EditorFactory 的容器创建方式；不能让两个容器错误复用同一个 IEditor |
| `shell/LLMWorkspaceEditor.ts` init/loadSession | 不再要求 nodeId 或 initializeExistingFile；按 sessionId 获取 snapshot、settings 和文件 context | 渲染 snapshot、commandBus、agent 选择、会话业务命令 |
| `services/SessionService.ts` | load/rename/delete 以 sessionId 为主；rename 修改标题，不重命名系统 Session 目录 | 对话层操作的业务语义 |
| `services/StateService.ts`、`shell/StateManager.ts` | UI 状态以 sessionId 定位，文件别名不再决定 UI state 存储 | debounce、输入草稿和布局恢复逻辑 |
| `shell/LLMWorkspaceEditor.ts` updateNodeId | 只处理旧引用文件或普通文件目标；不能触发更换会话/重写 manifest | Round 内容更新与聊天业务状态 |
| `HistoryView.ts`、`history/SessionRenderer.ts`、`mdx/MDxController.ts` | moduleFS/ownerNodeId 换为明确文件上下文和 SessionAssetContext | 消息/Round ID、流式 chunk、DOM key、折叠与分支展示 |
| `commands/WorkspaceCommands.ts`、附件管理入口 | 打印/导出从 Session 导出正文，用 assets context 解析图片；不要求 `.chat` ownerPath | Markdown 导出、复制、打印 UI |
| `context-menu/AIContextMenu.ts` | 普通文件菜单使用 IFileSystem；会话菜单通过 Session 服务 create/rename/delete | agent 选择与授权的业务动作 |
| `shell/RunAttachmentController.ts` | openTask 应绑定并验证所属 Session；切换时解绑旧流并检查 generation | AttachedTask 及 pause/resume/interrupt/approve 控制协议 |
| `shell/SessionEventHandler.ts` 等 | 分清 durable Session 与消息投影 ID，事件来自当前绑定 context | 已按 Session ID 过滤的业务事件处理 |

聊天附件不能简单把 `ownerNodeId` 换成 `/var/lib/sessions/<id>`。当前 MDX AssetResolver 通过 createMDXFile(moduleFS, ownerNodeId) 解析 @asset；该 owner 在新布局中不再是普通 `.chat` 文件。需要显式资产上下文，并让 upload、asset manager、print 使用同一入口。清理单条消息未使用图片不能删除其他 Round/分支仍引用的附件。

切换会话的并发规则：先递增 generation/解绑旧视图订阅 → 保存属于旧 sessionId 的草稿 → acquire 新 context → generation 仍匹配才安装 → 释放旧 lease。迟到的 snapshot、上传、搜索结果不能写入新会话；Blob URL、watch、debounce 保存闭包都绑定原 owner/session。失败时释放新 lease，呈现明确错误。

`RunAttachmentController.detach()` 保留“停止观察”的含义，关闭编辑器不自动 cancel Task，也不关闭 durable Session。文件挂载配置变更与 Task 执行 cleanup 由能力协调器管理，不能靠 UI dispose 达成撤权。

## 5. 其他必须修改或审查的依赖方

这里“上游”按影响角色区分：底层契约包、直接消费包、最终应用入口；不只有两个 UI 包。

| 包/入口 | 范围 | 原因与修改位置 |
| --- | --- | --- |
| `llm-session` | 必改，业务核心 | `persistence/types.ts` 的 IChatEngine、chat-engine、chat-kernel-storage、RoundGraph/Log、context-profile-store、durable-conversation-projection、session/session-manager；路径型 chat repository 改 sessionId 型，保留 Round/schema 和业务事件 |
| `vfs-ui` | 必改，文件 UI | createVFSUI、shell/Assembler、VFSUIShell、services/VFSService、EngineAdapter、editor-connector、mention providers；输入 IFileSystem、处理合成节点/readonly/capability/invalidated；文件选中事件不再冒充 durable Session |
| `ui-common` | 必改，公共契约 | EditorOptions、EditorHostContext、BaseSettingsEditor；新增 target/files/assets，旧 nodeId/moduleFS 在边界兼容。新 FileContext 不能 import app-shell，类型下沉避免依赖环 |
| `common` | 必改，路由与工具契约 | INavigation、navigation-events、ToolVFSContext；路由带类型和 scope，旧 resourceId 由受控 resolver 转换 |
| `mdx`（包名 mdxeditor） | 必改，编辑器基础 | core types/plugin-manager、engine-metadata-store、asset-resolver、upload、asset-manager、titlebar、renderer、print、cloze 插件；普通文件改 IFileSystem，聊天资产使用显式 context |
| `kernel-adapters` | 必改，运行时注入 | runtime/create-kernel-adapters-runtime.ts 的 createScope 增加 sessionId/绑定能力；vfsContext/nativeShell 不再全局注入真实 Session；skills hydration 也使用当前权限 |
| `tools` | 必改，工具访问边界 | ToolUseContext、Read/Write/Edit/Glob/Grep/Bash 路径选择；Session 模式强制使用已注入文件能力，不能优先 node:fs 或无约束 rg/fd |
| `durable-kernel` | 必改，持久恢复 | storage port、Session binding、注册/迁移意图、恢复顺序；保留 Task/IPC 业务协议，存储路径变更不应改其身份 |
| `app-settings` | 部分必改 | SettingsEngine/SkillsEngine/SystemVFSEngine、SettingsService、SnapshotService、SyncService；部分本来是合成业务视图，不能粗暴当普通目录迁移；备份需包含系统 Session 状态而非只有 home |
| `device-llm` | 必审且接入必改 | connection/provider/mcp/skill/system-prompt/cost 等服务仍接 IVFSManager；短期可信 adapter 维持，长期注入配置/状态 port；共享模型客户端与每 Session 的设备授权分开 |
| `llm-settings-ui` | 类型与入口联动 | AgentConfigEditor 的 moduleFS 与 nodeId 是配置实体上下文，改 EditorTarget.entity，保留业务服务编辑 |
| `vfsdriver-localfs` / `vfsdriver-indexeddb` | backend 适配与验证 | 一般 IStorageBackend CRUD 可保留；需要身份/权限/sidecar/事务能力报告，源 lease 与事件；浏览器不能被假定有宿主路径 |
| `apps/tauri-app` | 必改，平台落地 | main.ts 当前按 workspace module 建 backend；services/local-mounts.ts 当前挂 `/module/mnt_*` 且写 etc:/mounts.json；改来源授权+namespace 配置，卸载不 close 他人共享 backend |
| `apps/web-app` | 必改，启动配置 | workspace/路由/后端组装适配新 AppOptions；IndexedDB 迁移和不可用 host 授权的恢复状态 |
| `apps/cli` | 必改，独立运行入口 | runtime.ts 自建 VFS/kernel，不能只改 app-shell；相同 storage layout、Session scope 注入和 native execution 边界 |
| `device-tty` | 执行能力接入审查 | TTY 属 OS 执行面，不因 VFS 目录映射自动隔离；原 Task stop/cleanup 协议须与 Session 配置撤权衔接 |
| `llm-flow` / `llm-tasks` | 以集成验证为主 | Flow/Task 的业务 ID 和调度协议不应为路径迁移重写；创建聊天 Session、传递文件资源的位置需随新 context 更新 |
| `demo` / `apps/sync-server` | 依赖/协议审查 | demo 的旧初始化示例同步更新；sync-server 是否需要改取决于实际同步 payload，不能从包名断言必须重写 |

特别注意 `BaseModuleService` 的派生服务：ChatEngine/FlowEngine/VFSAgentService 不应一律使用同一种 FileSystemView 替换。Chat 是 Session repository，Flow/Agent 是业务实体存储，普通笔记才是文件目录；共享低层 VFS 并不意味着共享 UI CRUD 协议。

## 6. 新的应用接入接口与依赖方向

```ts
// ui-common：既有 EditorOptions 增补，legacy 字段逐步废弃。
interface EditorContextOptions {
  target: EditorTarget;
  files?: EditorFileContext;
  assets?: SessionAssetContext;
}

// llm-session：应用可见端口的增量示意；沿用已有 settings/snapshot 类型。
interface ConversationOpenRef { sessionId: string; }
interface ConversationCatalogPort {
  list(options?: { cursor?: string; limit?: number }): Promise<{
    items: Array<{ sessionId: string; title: string; updatedAt: number }>;
    nextCursor?: string;
  }>;
  create(options: { title: string; requestId: string }): Promise<ConversationOpenRef>;
  rename(sessionId: string, title: string,
    options: { expectedVersion: number }): Promise<void>;
  // 仅接受删除意图，停止执行及 GC 的完成状态须另行查询。
  requestDelete(sessionId: string,
    options: { requestId: string }): Promise<{ operationId: string }>;
}

// app-shell：文件 workspace 与会话 workspace 的组装职责分开。
type WorkspaceBinding =
  | { kind: 'files'; acquire(): Promise<AppFileContextOwner> }
  | { kind: 'conversations'; catalog: ConversationCatalogPort };

// kernel-adapters：真实 Session 必须用 factory，legacy 全局参数只用于可信旧 scope。
interface SessionToolContextFactory {
  acquire(sessionId: string): Promise<{
    files: ToolVFSContext;
    cwd: string;
    // 实际类型沿用执行 sandbox 契约；不可直接塞无约束 INativeShell。
    execution?: SessionExecutionSandbox;
    release(): Promise<void>;
  }>;
}
```

上述为对主文第 11 节的应用侧补充，不宣称这些类型已存在。ConversationCatalogPort 应从权威 Session/对话记录生成列表，索引可以重建；不能从文件树扫描 `.chat` 作为唯一 catalog。创建需与 kernel 注册协调并按 requestId 幂等，不能因 UI 重试留下孤儿会话。

依赖方向：common/ui-common 定义 UI 与导航契约；llm-session 定义对话数据/命令端口；vfs-core 定义文件能力；app-shell 注入这些端口；llm-ui 消费端口而不反向 import app-shell。主文 AppFileContext 的可复用子集应下沉为 ui-common 的 EditorFileContext 或依赖 vfs-core 的共享契约，避免 UI/组装层循环依赖。

## 7. 分阶段兼容落地与验收

1. **先建立类型边界。** 下沉 IFileSystem 与 EditorTarget，迁移 ui-common/vfs-ui/mdx 的普通文件消费；新旧字段只在入口 adapter 处理。旧 module 实现仍可运行原工作区。
2. **迁移对话入口。** llm-session 提供 sessionId repository/catalog，旧 `.chat` 作为兼容 locator；llm-ui、聊天 Workbench、路由、HITL 与资产上下文改为 Session。此时 repository 可暂用旧物理存储，但不暴露旧定位方式给新 UI。
3. **原子切换存储权威。** 按主文迁移 manifest、Round、profile、资产、kernel/catalog，保存旧 locator 映射和版本。验证后台恢复不依赖编辑器，之后停止旧数据写入。
4. **开放 Session 命名空间。** kernel-adapters 按 Session 注入同一 revision facade，tools 去 fallback；app-shell 安装系统 profile 和 `/workspace`，Tauri/web/CLI 同步接入。
5. **删除 legacy 主路径。** 旧书签 resolver 可保留，IModuleFS/manager 只在尚未迁完的可信服务中使用；全量消费端验收后再移除 deprecated 字段。

验收以跨包场景为准：

- 旧会话升级后 Session/Task/Round/分支 ID 不变，消息、设置、图片、上下文和暂停任务完整；旧链接打开同一会话。
- 新建/重命名/删除会话走业务服务；文件引用删除不删除会话；不打开 UI 也能恢复后台任务。
- 两个 Session 的 `/workspace/report.md` 内容不同，文件树、mention、编辑、打印和工具分别正确，搜索和缓存不串用。
- A→B 快速切换，A 的迟到 snapshot/流事件/上传/保存不写入 B；两个应用打开同一 Session 时编辑器实例独立。
- mount revoke 后编辑器、缓存、assets、watch、工具均失效；关闭一个窗口不影响另一个窗口或关闭共享 provider。
- 设备、配置编辑器、Agent/Skill/Flow 实体仍正确，不能误把实体 ID 当文件路径；系统投影不允许普通文件保存破坏账本。
- Tauri 的本地挂载卸载/重启、web IndexedDB 升级、CLI 恢复均通过相同语义检查；只有一个入口通过不算完成。

测试落在已有 app-shell 集成测试、llm-ui RunAttachmentController/服务测试、llm-session 持久化测试及 vfs-ui/mdx 资产测试。类型检查应覆盖所有改签名的消费包；实际执行结果单独记录于实现进度文档；这份清单不是全量验收已经完成的声明。
