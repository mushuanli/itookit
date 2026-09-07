# Session 浏览投影：vfs-ui、映射文件与 Task 历史

状态：已实现，2026-09-08。本文声明当前源码契约，补充 [VFS 总体设计](vfs-c4-review.md)。旧 `.chat + assetdir` 入口与 SessionWorkbench 手写侧栏已移除，不做旧数据兼容。

挂载的授权、UI、slash 与平台边界见 [Session 挂载与访问边界](vfs-session-mount-access.md)，已同步实现。

## 1. 目录与交互

```text
SessionBrowserFS:/
  <sessionId>/              显示会话标题；打开 Session 聊天
    tasks/                  Task 列表
      <taskId>              该 Task 的执行历史
    files/                  当前 SessionFS 的实际映射
      <SessionFS 目录与文件>
```

Session 直属入口只有 tasks/files。点击标题打开 main history，顶部 branch 切换和底部输入框由 llm-ui 提供；点击箭头仅展开目录。Session ID 决定路径，标题修改不改变路径。已打开的同一条目重复选择保持当前视图；离开后重新打开 Session 默认 main。

切换分支会更新 manifest.currentBranch/currentHead，后续发送沿该分支继续。草稿按 Session + branch 保存，切换期间禁用输入，关闭前等待草稿切换完成。运行中的 Session 保留已有的分支切换限制；重开正在运行的当前 main 分支允许执行。

tasks 显示列表；具体 Task 显示状态版本、输入、输出、错误以及执行事件的类型、时间和序号。Task 是只读执行信息，不是可续聊分支。历史读取为有限快照，不收集持续事件流。

files 直接代理受限 Session 文件上下文，不使用目录黑名单。未挂载时只有 attachments；用户明确授权后才增加 workspace 或其他目录。etc/var/dev/run/history 不在该用户上下文中，不能通过直接路径绕过。文本通过普通文件编辑器打开，文件身份和保存路径均为原 SessionFS 路径，cwd 为文件父目录；权限取自 capabilitiesAt。二进制文件提供下载，常见栅格图片提供预览，关闭时释放对象 URL。Session 聊天附件使用 `/attachments` 子视图。

投影自身只读，侧栏不提供文件 CRUD；文件编辑器通过单独持有的 Session 文件上下文保存。新建 Session 是宿主注入的业务按钮，调用 repository.createSession，不写虚拟目录。改标题仍调用 repository.updateManifest。

## 2. C4 组件边界

```mermaid
C4Component
  title Session 浏览与打开组件
  Container_Boundary(app, "app-shell") {
    Component(host, "SessionWorkbench", "Controller", "路由、主视图与文件上下文生命周期")
    Component(browser, "SessionBrowserFS", "IStorageBackend + FileSystemSource", "只读目录投影和显式目标解析")
    Component(files, "SessionFilesService", "Service", "挂载配置、授权、来源撤销")
  }
  Component(sidebar, "vfs-ui", "UI", "搜索、排序、目录展开、选择与折叠")
  Component(chat, "llm-ui", "EditorFactory", "main/branch history 与输入、分支草稿")
  Component(repo, "SessionRepository", "llm-session", "Session 元信息、历史与附件")
  Component(kernel, "Kernel", "durable-kernel", "Session 范围的 Task 查询")
  Component(vfs, "SessionFS", "vfs-core IFileSystem", "当前附件与显式授予的文件来源")
  Rel(sidebar, browser, "读取目录与摘要")
  Rel(sidebar, host, "sessionSelected")
  Rel(host, chat, "打开 Session")
  Rel(host, kernel, "查看 Task 历史")
  Rel(host, files, "取得编辑器上下文")
  Rel(browser, repo, "读取 Session 摘要")
  Rel(browser, kernel, "读取 Task 摘要与历史")
  Rel(browser, files, "按操作取得上下文")
  Rel(files, vfs, "组合并撤销映射")
```

Browser 是 admin 宿主的浏览能力，不自动挂到 Session 工具上下文，也不把自身挂进 files，避免递归。vfs-core 不引入 Session/Task 业务类型。投影是读取适配器，不新增第二份 Session 权威数据。

Task 展示选择明确字段；不序列化 currentAttempt、租约、资源令牌等内部结构。所有 Task 查询使用 sessionId + taskId。原始 Kernel 账本不会通过 Task 视图直接输出。

## 3. 已实现接口与改动

`packages/app-shell/src/files/session-browser.ts`：

```ts
type BrowserTarget =
  | { kind: 'session'; sessionId: string }
  | { kind: 'tasks'; sessionId: string }
  | { kind: 'task'; sessionId: string; taskId: string }
  | { kind: 'files'; sessionId: string; path: string };

interface SessionBrowserDependencies {
  repository: ISessionRepository;
  files: SessionFilesService;
  kernel: Kernel;
}
function resolveBrowserTarget(path: string): BrowserTarget;
function createSessionBrowser(deps: SessionBrowserDependencies): Promise<FileSystemSourceOwner>;
```

files 的目录/文件身份通过 SessionFS.driver.getNode 查询，不能按扩展名判断业务目标。`FileSystemSourceOwner` 复用 vfs-core 的 `{ fs, dispose() }` 生命周期。内部 BrowserBackend 实现 IStorageBackend，所有 mutation 方法拒绝 EROFS。

Task 展示 DTO 由 `taskSummary(TaskRecord)` 选择以下字段：id、sessionId、parentTaskId、program、status、version、createdAt、updatedAt、input、output、error（来自 lastError）。Task 版本读取复用 Kernel.taskHistory；事件使用 Kernel.eventList 的有限快照，按 taskId 筛选。新 Session 尚无 Kernel 记录时 tasks 返回空列表。

vfs-ui 的 `VFSUIOptions` / `VFSUIShellOptions` 调整：

```ts
interface BrowserUIOptions {
  defaultEditorFactory?: EditorFactory; // 仅列表模式可省略
  activateDirectories?: boolean;       // 默认 false；投影开启
  primaryAction?: { label: string; run(): Promise<void> };
  directoryAction?: { label: string; visible(path: string): boolean; run(path: string): Promise<void> };
}
// VFSUIShell 新增
refresh(): Promise<void>;               // 重载并恢复已展开目录
selectPath(path: string): Promise<void>; // 展开祖先后选择条目
```

不新增通用资源框架或 operationPolicy。Browser 使用 readOnly，普通文件模式保持已有命令系统。只读模式仍订阅读取事件和保存 UI 状态。Store 的 SESSION_SELECT 接受存在的目录条目；NodeList 根据 activateDirectories 决定目录标题是否发出选择。

`SessionWorkbench` 构造依赖增加 Kernel 与普通文件 EditorFactory。它持有 Browser source、vfs-ui shell、当前编辑器和其独立上下文，通过 resolveBrowserTarget 打开对应视图。bootstrap 提供这些依赖，Web/Tauri 共用。

`SessionFilesService.subscribe(listener: () => void): () => void` 通知挂载配置和注册来源变化；宿主合并刷新请求。Browser 文件读取每次取得当前上下文并在 finally 中释放，编辑器则独立持有固定上下文直至关闭；撤销后旧句柄不能重新获权。

llm-session / llm-ui 草稿接口：

```ts
interface ConversationUIState {
  branchDrafts?: Record<string, { inputText?: string; inputAgentId?: string }>;
  // 其余会话 UI 状态保持原定义；删除全局 inputText/inputAgentId。
}
// StateService
saveUIState(sessionId: string, state: UIState, branch = 'main'): Promise<void>;
loadUIState(sessionId: string, branch = 'main'): Promise<UIState | null>;
// StateManager
switchDraftBranch(branch: string): Promise<void>;
waitForDrafts(): Promise<void>;
```

Repository 在事务内按 branch 合并 branchDrafts，空字符串明确清空草稿。SessionService.ensureReady(sessionId, branch = 'main') 绑定后切换指定分支；普通打开 main，挂载后重载通过 EditorTarget.branch 保留当前分支，StateManager 以同一分支恢复草稿；BranchService 接受 null-head 的空分支，同分支 no-op 在生成状态检查前返回。

## 4. 打开与生命周期

```mermaid
sequenceDiagram
  participant U as 用户
  participant UI as vfs-ui
  participant H as SessionWorkbench
  participant B as BrowserFS
  participant F as SessionFilesService
  participant E as Editor / Task View
  U->>UI: 点击标题
  UI->>H: sessionSelected(path)
  H->>H: 解析目标，串行打开，释放旧编辑器
  alt Session 或映射文件
    H->>F: acquireFiles(sessionId, cwd)
    F-->>H: 独立上下文
    H->>E: 传入业务身份、上下文与保存动作
  else tasks 或 Task
    H->>B: 列目录 / 查询对应 Kernel 记录
    H->>E: 只读列表 / 执行历史
  end
  H->>UI: selectPath(path)
  Note over UI,H: 程序选择回写不再触发重复打开
  U->>UI: 点击展开箭头
  UI->>B: getChildren(path)
  Note over UI,E: 展开不切换主视图
```

- 根只读 Session 摘要，展开 tasks 才读 Task 摘要；不会在加载侧栏时读取所有 Task 历史。
- 仓库、Kernel 与来源通知触发合并刷新。主视图查询使用 generation 丢弃迟到结果，程序选择回写被识别，避免连续导航形成循环。
- 浏览状态独立存于 `session-browser:v1:admin`，不恢复旧聊天文件树。
- 编辑器创建失败、创建期间关闭、正常切换均释放文件上下文和附件视图。退出解除订阅，等待打开/刷新结束，然后销毁消费者与投影。
- 后台刷新错误不会替换正在编辑的内容。

## 5. 验证与边界

自动测试覆盖：真实 DOM 下标题/箭头独立、目录选择和刷新；宿主通过真实 vfs-ui 打开聊天/Task/映射文件并保存；快速连续导航；仅 tasks/files 入口；Task 字段隔离、Session 范围查询；映射撤销；空 main、运行中重开当前分支；分支草稿合并和快速切换；失败/迟到编辑器释放。

当前 Task 历史为全量有限快照，刷新重新读取；尚未实现存储层分页或按 Task 索引的事件分页。大量历史需要后续扩展 Kernel 查询接口，不能将前端数组切片宣称为底层分页。当前 URL 保存资源路径，不编码聊天 branch；浏览器前进/后退精确恢复分支未提供。文件侧栏 CRUD 与通用文件类型插件路由也不在本实现中，二进制提供安全预览/下载。

本次使用 jsdom 自动交互验证，尚未进行真实浏览器/Tauri GUI 人工验收。

files 的目录动作与主视图按钮复用挂载弹窗。slash 经 EditorHostContext.directoryCommands 调用同一宿主服务，不发送给模型。授权变更先撤销旧文件上下文，再重新打开当前 Session 编辑器；关闭 workbench 同时关闭弹窗。
