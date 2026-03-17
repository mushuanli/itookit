

```markdown
# LLM Workspace Editor — Design Document

> 本文档是架构设计的权威参考。所有功能开发、接口修改、代码审查必须遵循此文档中的规则。

---

## 1. 架构原则

### 1.1 核心约束

| 编号 | 原则 | 约束 |
|------|------|------|
| **P1** | 单向依赖 | 外层 → 内层，禁止反向或跨层捷径 |
| **P2** | 接口隔离 | 层间通过 `domain/ports` 通信，不引用实现类 |
| **P3** | 数据驱动 | UI 是数据的投影，不持有业务状态 |
| **P4** | 声明式扩展 | 新增事件/操作通过声明表或注册，不修改 switch/if |
| **P5** | 资源必回收 | Timer → `TimerManager`，Event → `EventCleanup`，无例外 |

### 1.2 设计决策记录

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 组件通信 | Props 回调 / EventBus / 状态管理 | **EventBus（实例级）** | 多对多通信，避免 prop drilling，实例级避免全局污染 |
| 操作封装 | 方法内联 / Command 模式 | **Command 模式** | 统一错误处理，可测试，符合 OCP |
| 事件处理 | switch/case / 声明表 | **声明表** | 新增事件只改数据，不改逻辑 |
| View 交互 | 直接引用 / 接口 | **接口（ports）** | 允许替换实现，Command 可独立测试 |
| 状态持久化 | 即时保存 / 防抖 | **防抖（2s/1s）** | 避免高频写入，生成中跳过 |

---

## 2. 分层架构

### 2.1 层级定义

```
Layer 0  infrastructure/    基础设施    零业务知识
Layer 1  domain/            契约层      纯类型 + 接口
Layer 2  services/          服务层      数据操作
Layer 3  commands/          命令层      操作编排
Layer 4  components/        组件层      UI 实现
Layer 5  shell/             壳层        组装 + 路由
```

### 2.2 依赖矩阵

被依赖方 →

| 依赖方 ↓ | infrastructure | domain | services | commands | components | shell |
|----------|:-:|:-:|:-:|:-:|:-:|:-:|
| **infrastructure** | — | ❌ | ❌ | ❌ | ❌ | ❌ |
| **domain** | ❌ | — | ❌ | ❌ | ❌ | ❌ |
| **services** | ✅ | ✅ types | — | ❌ | ❌ | ❌ |
| **commands** | ✅ | ✅ ports+types | ✅ | — | ❌ | ❌ |
| **components** | ✅ | ✅ ports+types | ❌ | ❌ | — | ❌ |
| **shell** | ✅ | ✅ | ✅ | ✅ | ✅ 构造时 | — |

关键约束：
- **commands → components**: ❌ 禁止。Command 通过 `domain/ports` 接口操作 UI
- **components → services**: ❌ 禁止。组件不直接获取数据，由 Shell 推送
- **shell → components**: ✅ 仅在构造时引用具体类，运行时通过接口

### 2.3 目录结构

```
llm-ui/
├── index.ts                          # 公共 API
│
├── infrastructure/                   # Layer 0
│   ├── TimerManager.ts               #   定时器生命周期
│   ├── EventCleanup.ts               #   事件监听器生命周期
│   ├── DOMCache.ts                   #   DOM 查询缓存（WeakRef）
│   ├── ScrollController.ts           #   统一滚动控制
│   ├── ContentResizeTracker.ts       #   高度变化监听（ResizeObserver）
│   ├── StreamRenderPipeline.ts       #   流式渲染 RAF 管线
│   ├── EventBatchProcessor.ts        #   事件合并批处理
│   └── index.ts
│
├── domain/                           # Layer 1
│   ├── types.ts                      #   NodeAction, BranchItem, CollapseStateMap...
│   ├── events.ts                     #   EditorBusEvents, IEditorEventBus
│   ├── ports/                        #   接口契约
│   │   ├── IHistoryPresenter.ts
│   │   ├── IChatInputPresenter.ts
│   │   ├── IStatusPresenter.ts
│   │   ├── IBranchPresenter.ts
│   │   ├── INavigationPresenter.ts
│   │   └── index.ts
│   └── index.ts
│
├── services/                         # Layer 2
│   ├── SessionService.ts             #   会话生命周期
│   ├── StateService.ts               #   UI 状态持久化
│   ├── AssetService.ts               #   附件管理
│   ├── AgentLoader.ts                #   Agent 列表加载/校验
│   ├── BranchStore.ts                #   分支数据源（唯一真相）
│   ├── NavDataBuilder.ts             #   导航面板数据构建
│   └── index.ts
│
├── commands/                         # Layer 3
│   ├── Command.ts                    #   基类
│   ├── CommandContext.ts             #   依赖接口（面向 ports）
│   ├── CommandRegistry.ts            #   EventBus → Command 绑定
│   ├── SendMessageCommand.ts
│   ├── BranchCommands.ts
│   ├── NodeCommands.ts
│   ├── BatchCommands.ts
│   ├── WorkspaceCommands.ts
│   └── index.ts
│
├── components/                       # Layer 4
│   ├── history/                      #   对话历史 UI
│   │   ├── HistoryView.ts            #   Facade (implements IHistoryPresenter)
│   │   ├── SessionRenderer.ts        #   DOM 渲染 + MDxController 管理
│   │   ├── StreamController.ts       #   流式输出控制
│   │   ├── CollapseController.ts     #   折叠状态控制
│   │   ├── EditController.ts         #   编辑模式控制
│   │   ├── EventDispatcher.ts        #   点击事件委托
│   │   ├── NodeRenderer.ts           #   节点 DOM 工厂
│   │   └── index.ts
│   ├── input/                        #   聊天输入
│   │   ├── ChatInputView.ts          #   implements IChatInputPresenter
│   │   └── index.ts
│   ├── indicators/                   #   状态指示器
│   │   ├── StatusIndicatorView.ts    #   implements IStatusPresenter
│   │   ├── BranchIndicatorView.ts    #   implements IBranchPresenter
│   │   └── index.ts
│   ├── navigation/                   #   浮动导航面板
│   │   ├── FloatingNavPanel.ts       #   implements INavigationPresenter
│   │   └── index.ts
│   ├── mdx/                          #   Markdown 编辑器封装
│   │   ├── MDxController.ts
│   │   └── index.ts
│   └── templates/                    #   HTML 模板（纯函数）
│       ├── LayoutTemplates.ts
│       ├── NodeTemplates.ts
│       ├── ChatInputTemplates.ts
│       ├── ErrorTemplates.ts
│       ├── BranchIndicatorTemplates.ts
│       ├── FloatingNavPanelTemplates.ts
│       └── index.ts
│
├── shell/                            # Layer 5
│   ├── LLMWorkspaceEditor.ts         #   Composition Root
│   ├── EditorEventBus.ts             #   IEditorEventBus 实现
│   ├── SessionEventHandler.ts        #   引擎事件 → 副作用
│   ├── StateManager.ts               #   防抖持久化
│   └── EventBinder.ts                #   DOM 事件 + 快捷键绑定
│
├── editors/                          #   独立编辑器
│   ├── AgentConfigEditor.ts
│   ├── ConnectionSettingsEditor.ts
│   └── MCPSettingsEditor.ts
│
├── utils/                            #   工具函数（可被任意层引用）
│   ├── textUtils.ts
│   ├── iconResolver.ts
│   ├── errorHandler.ts
│   ├── debounce.ts
│   └── index.ts
│
└── styles/
    └── index.css
```

---

## 3. 接口契约

### 3.1 Port 接口规范

所有 port 接口遵循以下规则：

```
规则 1: 接口文件只包含 interface 和 type，不包含 class 或函数实现
规则 2: 接口方法的参数和返回值只使用 domain/types 中的类型或原始类型
规则 3: 接口方法不暴露 DOM 内部结构（HTMLElement 仅限必要的查询返回值）
规则 4: 每个接口必须包含 destroy() 方法
规则 5: 新增方法标记为可选（?:）以保持向后兼容
```

### 3.2 IHistoryPresenter

```typescript
interface IHistoryPresenter {
    // 渲染
    renderFull(sessions: SessionGroup[]): void;
    renderWelcome(): void;
    renderError(error: Error): void;
    clearErrors(): void;

    // 消息操作
    removeMessages(ids: string[], animated: boolean): string[];

    // 折叠
    getCollapseStates(): CollapseStateMap;
    toggleSessionCollapse(sessionId: string, forceState?: boolean): void;
    setAllCollapsed(collapsed: boolean): void;
    toggleAllFold(): boolean;
    shouldShowCollapseIcon(): boolean;
    foldFirstUnfolded(): void;

    // 滚动
    scrollToBottom(force: boolean): void;

    // 流式
    enterStreamingMode(): void;
    exitStreamingMode(): void;

    // 查询
    getSessionElement(sessionId: string): HTMLElement | null;
    getAgentNavigationTarget(direction: 'prev' | 'next'): string | null | '__end__' | '__start__';

    // 引擎事件
    processEvent(event: OrchestratorEvent): void;

    // 生命周期
    destroy(): void;
}
```

### 3.3 IChatInputPresenter

```typescript
interface IChatInputConfig {
    text: string;
    agentId: string;
    settings?: any;
}

interface IChatInputPresenter {
    setLoading(loading: boolean): void;
    setConfig(config: Partial<IChatInputConfig>): void;
    getConfig(): IChatInputConfig;
    restoreInput(text: string, agentId?: string): void;
    focus(): void;
    refreshAgents(
        agents: ExecutorOption[],
        validateAgentId: (id: string, agents: ExecutorOption[]) => string
    ): boolean;
    destroy(): void;
}
```

### 3.4 IStatusPresenter

```typescript
interface IStatusPresenter {
    update(status: string): void;
    updateFromSnapshot(snapshot: any): void;
    updateBackground(payload: { running: number; queued: number }): void;
    cacheElements(): void;
    destroy(): void;
}
```

### 3.5 IBranchPresenter

```typescript
interface IBranchPresenter {
    refresh(): Promise<void>;
    flash(): void;
    destroy(): void;
}
```

### 3.6 INavigationPresenter

```typescript
interface NavPanelData {
    items: any[];
    branches: BranchItem[];
    currentSessionId?: string;
}

interface INavigationPresenter {
    readonly isVisible: boolean;
    toggle(): void;
    update(data: NavPanelData): void;
    destroy(): void;
}
```

### 3.7 IEditorEventBus

```typescript
interface IEditorEventBus {
    on<K extends EditorEventKey>(event: K, callback: (payload: EditorBusEvents[K]) => void): () => void;
    emit<K extends EditorEventKey>(event: K, payload: EditorBusEvents[K]): void;
    once<K extends EditorEventKey>(event: K, callback: (payload: EditorBusEvents[K]) => void): () => void;
    destroy(): void;
}
```

---

## 4. 接口修改规则

### 4.1 非破坏性变更（允许直接合入）

```typescript
// ✅ 新增可选方法
interface IHistoryPresenter {
    existingMethod(): void;
    newOptionalMethod?(): void;    // 不破坏现有实现
}

// ✅ 新增可选参数
interface IHistoryPresenter {
    renderFull(sessions: SessionGroup[], options?: RenderOptions): void;
}

// ✅ 放宽返回类型
interface IHistoryPresenter {
    // 从 string 放宽到 string | null
    getSessionElement(id: string): HTMLElement | null;
}

// ✅ 新增事件类型
interface EditorBusEvents {
    // 原有事件不变...
    'new:event': { data: string };   // 新增
}
```

### 4.2 破坏性变更（需要 RFC 流程）

```typescript
// ❌ 修改已有方法签名
renderFull(sessions: SessionGroup[]): void;
→ renderFull(sessions: SessionGroup[], mode: string): void;

// ❌ 删除已有方法
// ❌ 修改已有方法的返回类型（缩窄）
// ❌ 将可选参数改为必需
// ❌ 重命名方法

// 破坏性变更的执行步骤：
// 1. 标记旧方法 @deprecated，添加新方法
// 2. 迁移所有调用方
// 3. 下一个主版本移除旧方法
```

```markdown
### 4.3 接口变更检查清单

```
□ 变更属于哪种类型？（非破坏/破坏）
□ 所有实现类是否已适配？
  - 搜索 `implements IXxxPresenter` 找到所有实现
□ 所有消费方是否已适配？
  - 搜索 `IXxxPresenter` 的 import 找到所有使用处
  - 包括 CommandContext 中的引用
□ 新增的类型是否定义在 domain/types.ts 中？
□ 是否需要同步更新 README.md 的接口参考？
□ 是否需要同步更新本文档？
```

---

## 5. 事件系统

### 5.1 EventBus 事件注册流程

新增 EventBus 事件的完整步骤：

```
Step 1: domain/events.ts — 添加类型定义
Step 2: 发送方 — emit() 调用
Step 3: 接收方 — on() 注册（CommandRegistry 或组件内部）
Step 4: 如果需要 Command 处理 → 新建 Command + CommandRegistry 绑定
Step 5: 更新本文档 §5.2 事件目录
```

```typescript
// Step 1: domain/events.ts
interface EditorBusEvents {
    // ... 已有事件
    'new:action': { targetId: string; value: number };  // 新增
}

// Step 2: 发送方（Component 或 Shell）
this.bus.emit('new:action', { targetId: 'xxx', value: 42 });

// Step 3a: CommandRegistry 绑定（复杂逻辑）
this.bindCommand('new:action', new NewActionCommand(this.ctx));

// Step 3b: 内联处理（简单逻辑）
this.bindInline('new:action', async ({ targetId, value }) => {
    // ...
});
```

### 5.2 事件目录

| 事件 | 发送方 | 接收方 | 用途 |
|------|--------|--------|------|
| `branch:create` | EventDispatcher, FloatingNavPanel, Shell | CreateBranchCommand | 创建分支 |
| `branch:switch` | BranchIndicatorView, FloatingNavPanel | SwitchBranchCommand | 切换分支 |
| `branch:switchById` | FloatingNavPanel | SwitchBranchByIdCommand | 按 headNodeId 切换 |
| `branch:rename` | FloatingNavPanel | RenameBranchCommand | 重命名分支 |
| `branch:delete` | FloatingNavPanel | DeleteBranchCommand | 删除分支 |
| `nav:scrollTo` | FloatingNavPanel, Shell | CommandRegistry (inline) | 滚动到指定消息 |
| `nav:toggleFold` | FloatingNavPanel | CommandRegistry (inline) | 切换单条折叠 |
| `nav:foldAll` | FloatingNavPanel | CommandRegistry (inline) | 全部折叠 |
| `nav:unfoldAll` | FloatingNavPanel | CommandRegistry (inline) | 全部展开 |
| `batch:delete` | FloatingNavPanel | BatchDeleteCommand | 批量删除 |
| `batch:copy` | FloatingNavPanel | BatchCopyCommand | 批量复制 |
| `content:copy` | CommandRegistry | CommandRegistry (inline) | 复制单条内容 |
| `state:collapseChanged` | CollapseController, Shell | Shell (StateManager) | 折叠状态持久化 |
| `state:inputChanged` | ChatInput, Shell | Shell (StateManager) | 输入状态持久化 |

### 5.3 引擎事件处理

引擎事件通过 `SessionEventHandler` 中的声明表处理。

**副作用声明表**

```typescript
const EVENT_SIDE_EFFECTS: Record<string, SideEffect[]> = {
    session_start:        ['clearErrors', 'updateStatus', 'notifyChange'],
    finished:             ['clearErrors', 'updateStatus', 'notifyChange', 'refreshNav'],
    error:                ['updateStatus'],
    branch_created:       ['renderFull', 'scrollToBottom', 'refreshBranch', 'flashIndicator'],
    branch_switched:      ['renderFull', 'scrollToBottom', 'refreshBranch', 'flashIndicator'],
    branch_deleted:       ['refreshBranch', 'refreshNav'],
    branch_renamed:       ['refreshBranch'],
    messages_deleted:     ['refreshNav', 'notifyChange'],
    message_edited:       ['refreshNav'],
    session_cleared:      ['refreshNav', 'refreshBranch'],
    regenerate_started:   ['clearErrors', 'flashIndicator'],
    regenerate_completed: ['refreshBranch', 'refreshNav'],
};
```

**新增引擎事件的步骤**

```
Step 1: 在 EVENT_SIDE_EFFECTS 表中添加一行
Step 2: 如果需要 HistoryView 处理 DOM → 在 processEventImmediate 中添加 case
Step 3: 如果需要新的副作用类型 → 在 executors 中注册执行函数
Step 4: 如果是不可合并事件 → 添加到 EventBatchProcessor 的 immediateTypes
Step 5: 更新本文档 §5.3
```

**副作用类型参考**

| 副作用 | 执行内容 | 使用场景 |
|--------|---------|---------|
| `renderFull` | 重新渲染完整会话列表 | 分支切换/创建 |
| `refreshBranch` | 刷新 BranchStore | 分支结构变更 |
| `refreshNav` | 推送数据到 FloatingNavPanel | 消息/分支变更 |
| `flashIndicator` | 分支指示器闪烁动画 | 分支切换/创建 |
| `scrollToBottom` | 滚动到底部 | 分支切换后定位 |
| `clearErrors` | 清除错误 banner | 新操作开始 |
| `updateStatus` | 更新状态指示器 | 会话状态变化 |
| `notifyChange` | 触发外部 change 事件 | 内容变更 |

---

## 6. Command 规范

### 6.1 Command 结构

```typescript
export class MyCommand extends Command<TParams, TResult> {
    // 必须：命令名称（用于日志和错误上报）
    protected readonly name = 'My Command';

    // 可选：错误严重级别（默认 'toast'）
    protected severity: ErrorSeverity = 'toast';

    // 必须：执行逻辑
    protected async execute(params: TParams): Promise<TResult> {
        // 通过 this.ctx 访问依赖
        // 只允许使用 CommandContext 中声明的接口
    }
}
```

### 6.2 CommandContext 使用规则

```
规则 1: 只通过 this.ctx 访问依赖，不自行 import 实现类
规则 2: this.ctx.historyView 是 IHistoryPresenter，不可 downcast
规则 3: this.ctx.chatInput 是 IChatInputPresenter，不可 downcast
规则 4: 需要新依赖时，先扩展对应的 port 接口，再修改 CommandContext
规则 5: 不在 Command 中持有可变状态（除非是执行过程中的临时状态）
```

### 6.3 错误处理级别

| 级别 | 行为 | 使用场景 |
|------|------|---------|
| `silent` | 仅 console.warn | 状态保存、非关键查询 |
| `warn` | console.warn + 内部通知 | 设置保存、历史加载 |
| `toast` | Toast 提示用户 | 发送失败、删除失败 |

### 6.4 Command 注册方式

```
方式 1: EventBus 驱动（适合多触发源的操作）
  → CommandRegistry.bindCommand('event:name', new MyCommand(ctx))
  → 触发：bus.emit('event:name', payload)

方式 2: 直接调用（适合单一入口的操作）
  → Shell 持有实例：this.myCommand = new MyCommand(ctx)
  → 触发：this.myCommand.run(params)

方式 3: 内联（适合 < 10 行的简单操作）
  → CommandRegistry.bindInline('event:name', async (payload) => { ... })
```

**选择依据**

```
有多个触发源（按钮 + 快捷键 + 面板）？ → 方式 1
只有一个调用处？                       → 方式 2
逻辑 < 10 行且不需要独立测试？          → 方式 3
```

---

## 7. 组件开发规范

### 7.1 组件结构

```typescript
// 每个组件必须：
export class MyComponent implements IMyPresenter {
    // 1. 声明实现哪个接口
    // 2. 使用 infrastructure/ 管理资源
    private timers = new TimerManager();
    private events = new EventCleanup();

    // 3. 构造函数只接受：container + options/config
    constructor(container: HTMLElement, options: MyOptions) {}

    // 4. 实现接口的所有方法
    // 5. 内部 DOM 操作不暴露给外部

    // 6. 必须实现 destroy
    destroy(): void {
        this.timers.destroy();
        this.events.cleanup();
        // 清理 DOM、引用等
    }
}
```

### 7.2 组件通信规则

```
组件 ↔ Shell:      通过 port 接口（Shell 调用接口方法）
组件 → 外部:       通过 options 中的回调函数
组件 ↔ 组件:       通过 IEditorEventBus（禁止直接引用）
组件 → 子控制器:    通过构造函数注入 + 直接方法调用
```

### 7.3 HistoryView 子控制器协作规则

```
HistoryView (Facade)
├── SessionRenderer    持有 DOM 引用 + MDxController 映射
├── StreamController   依赖 SessionRenderer.getEditor()
├── CollapseController 依赖 SessionRenderer.getEditor()（代码块折叠）
├── EditController     不依赖其他控制器
└── EventDispatcher    依赖所有控制器（事件路由）

规则：
- 子控制器之间不直接引用（通过 HistoryView 协调）
- SessionRenderer 是数据持有者，其他控制器通过它查询
- EventDispatcher 是入口，将事件路由到对应控制器
- 新增子控制器需要同时更新 EventDispatcher 的 actionMap
```

### 7.4 模板规范

```typescript
// templates/ 中的文件必须是纯函数，无副作用
export class MyTemplates {
    // ✅ 纯函数：输入 → HTML 字符串
    static renderItem(data: ItemData): string {
        return `<div class="my-item">${escapeHTML(data.text)}</div>`;
    }

    // ❌ 禁止：持有状态、操作 DOM、import 非 domain 模块
}

// 安全规则：
// - 用户输入必须经过 escapeHTML()
// - CSS 类名使用 BEM 命名：block__element--modifier
// - data-action 属性用于事件委托
// - data-xxx 属性用于数据传递
```

---

## 8. Services 开发规范

### 8.1 Service 结构

```typescript
export class MyService {
    // 1. 依赖通过构造函数注入
    constructor(
        private engine: ILLMSessionEngine,
        private sessionManager: SessionManager
    ) {}

    // 2. 方法是 async 的数据操作
    async loadData(id: string): Promise<Data | null> {}
    async saveData(id: string, data: Data): Promise<void> {}

    // 3. 不持有 UI 引用
    // 4. 不 import components/ 或 shell/
    // 5. 错误向上抛出（由 Command 或 Shell 的 ErrorHandler 处理）
}
```

### 8.2 BranchStore 使用契约

```
BranchStore 是分支数据的唯一真实来源（Single Source of Truth）。

规则：
- 读取分支数据只通过 BranchStore.current / currentBranch
- 刷新只通过 BranchStore.refresh()（内部合并并发）
- 不直接调用 SessionManager.listBranches()
- UI 更新通过 BranchStore.onChange() 订阅
- 脏检查避免无变化时的无意义通知
```

---

## 9. 数据流

### 9.1 发送消息流程

```
用户输入 → ChatInput.triggerSend()
  → options.onSend(text, files, agentId, overrides)
    → Shell 路由到 SendMessageCommand.run()
      → AssetService.uploadFiles()        [如有附件]
      → SessionManager.sendMessage()
        → Engine 处理
          → session_start 事件
            → SessionEventHandler
              → HistoryView.processEvent()  [渲染用户气泡]
              → clearErrors + updateStatus  [副作用表]
          → node_start / node_update 事件
            → EventBatchProcessor 合并
              → StreamController.updateContent()
                → MDxController.appendStream()
                  → StreamRenderPipeline.flushContent() [RAF]
          → finished 事件
            → SessionEventHandler
              → HistoryView.processEvent()  [退出流式]
              → refreshNav + notifyChange   [副作用表]
```

### 9.2 分支切换流程

```
用户点击分支 → BranchIndicatorView
  → bus.emit('branch:switch', { branchName })
    → CommandRegistry → SwitchBranchCommand.run()
      → SessionManager.switchBranch()
        → branch_switched 事件
          → SessionEventHandler
            → HistoryView.processEvent()    [resetStates]
            → renderFull                    [重渲染]
            → scrollToBottom                [定位]
            → refreshBranch                 [BranchStore.refresh()]
              → BranchStore.onChange()
                → BranchIndicatorView.render() [自动更新]
            → flashIndicator                [闪烁动画]
```

```markdown
### 9.3 状态持久化流程

```
用户操作（折叠/输入/选择 Agent）
  → Component 触发
    → bus.emit('state:collapseChanged') 或 bus.emit('state:inputChanged')
      → Shell 监听
        → StateManager.scheduleUIStateSave()  [防抖 2s]
        → StateManager.scheduleInputStateSave() [防抖 1s]
          → guard: sessionManager.isGenerating() ? 跳过 : 继续
            → StateService.saveUIState(nodeId, payload)
              → engine.updateUIState()

恢复流程（loadSession 时）：
  Shell.loadSession()
    → StateManager.loadUIState()
      → StateService.loadUIState()
    → StateManager.restoreInputState(chatInput, options)
      → 优先级：initialInputState > sessionStorage > savedState
```

### 9.4 导航面板数据流

```
数据流向：单向推送，面板不主动拉取

触发推送的时机：
  1. toggleNavigator() 首次打开 → pushNavDataImmediate()
  2. 引擎事件中 refreshNav 副作用 → pushNavData() [防抖 50ms]
  3. 分支切换/删除 → refreshNav 副作用

数据构建：
  Shell.buildNavData()
    → NavDataBuilder.build(sessions, collapseStates, branches, currentSessionId)
      → SessionManager.getBranchTree()  [尝试树形结构]
      → fallback: buildFlat()           [平铺列表]
    → floatingNav.update(data)          [推送到面板]

面板内操作的处理：
  FloatingNavPanel
    → 本地操作（选择/高亮）：立即更新 DOM
    → 远程操作（删除/切换）：bus.emit() → 等待事件回流 → update() 刷新
```

---

## 10. 性能约束

### 10.1 关键性能指标

| 指标 | 目标值 | 测量方法 |
|------|--------|---------|
| 流式首字渲染 | < 100ms | session_start → 首个 DOM 更新 |
| 流式帧率 | ≥ 30fps | RAF 循环中的 flush 频率 |
| 分支切换 | < 500ms | branch_switched → renderFull 完成 |
| 消息删除（UI） | < 16ms | 乐观更新的 DOM 操作时间 |
| 状态持久化 | 不阻塞 UI | 防抖 + async，无同步写入 |

### 10.2 性能敏感区域与约束

**流式渲染管线**

```
StreamRenderPipeline 配置：
  CONTENT_INTERVAL = 250ms    — 内容 flush 最小间隔
  每帧最多：1 次 layout read (scrollHeight) + 1 次 layout write (scrollTop)

约束：
  - 不在 flush 回调中触发同步 layout（避免 forced reflow）
  - scrollTo 在 flush 的下一帧执行（Phase 分离）
  - 流式期间 ContentResizeTracker 不工作（由 Pipeline 接管）
```

**EventBatchProcessor 配置**

```
自适应间隔：30ms - 150ms
  > 20 事件/批 → 间隔 × 1.2（降频）
  < 5  事件/批 → 间隔 × 0.8（提频）

约束：
  - immediateTypes 中的事件绕过缓冲，但先 flush 队列保证顺序
  - chunk 合并按 nodeId 分组，同一节点的多个 chunk 合并为一次渲染
  - status 合并取最后值（后覆盖前）
```

**ScrollController 配置**

```
SCROLL_THRESHOLD = 150px     — 距底部多少像素视为"在底部"
SCROLL_THROTTLE = 100ms      — 非流式滚动节流
STREAMING_SCROLL_INTERVAL = 120ms  — 流式滚动节流
程序滚动标记窗口 = 150ms     — 此期间 scroll 事件不更新用户状态

约束：
  - 流式期间用户上滚 → 停止自动滚动，直到用户滚回底部
  - forceScrollToBottom 仅用于用户明确操作（点击按钮）
  - 程序触发的滚动不得改变 _isUserScrolledUp 状态
```

**BranchStore 并发控制**

```
约束：
  - 并发 refresh() 调用复用同一 Promise
  - 数据脏检查：isEqual 比较后才通知监听器
  - branch_created + branch_switched 连续触发只产生一次请求
```

**StateManager 防抖配置**

```
UI 状态保存：2000ms 防抖
输入状态保存：1000ms 防抖
Guard：sessionManager.isGenerating() 时跳过保存

约束：
  - destroy 时同步保存一次（不等防抖）
  - isBeingDeleted 时跳过保存
  - NodeNotFound 错误静默处理
```

### 10.3 DOM 操作约束

```
规则 1: 批量 DOM 操作使用 DocumentFragment 或 innerHTML
规则 2: 事件监听使用事件委托（EventDispatcher 的 actionMap）
规则 3: DOM 查询结果通过 DOMCache 缓存（WeakRef 自动过期）
规则 4: 动画使用 CSS class 切换，不使用 JS 动画
规则 5: 删除动画结束后再移除 DOM（animationend 监听 + 350ms 兜底）
规则 6: 模板使用 innerHTML 一次性设置，不逐个 createElement
```

### 10.4 内存管理约束

```
规则 1: MDxController 在 removeMessages 时必须调用 destroy()
规则 2: EventCleanup 在组件 destroy 时必须调用 cleanup()
规则 3: TimerManager 在组件 destroy 时必须调用 destroy()
规则 4: BranchStore.listeners 在 destroy 时必须 clear()
规则 5: document 级事件监听器必须在 destroy 中移除
规则 6: ResizeObserver 必须 disconnect()
规则 7: FloatingNavPanel 隐藏时清空 selectedIds 和解绑键盘事件
```

---

## 11. 新增功能指南

### 11.1 决策树

```
需要新功能？
│
├─ 是纯 UI 交互（不涉及数据）？
│   └─ 在 Component 内部处理，不需要穿透到 Shell
│
├─ 需要操作数据（Session/Branch/State）？
│   ├─ 操作有多个触发源？ → 创建 Command + EventBus 绑定
│   └─ 只有一个触发源？   → 创建 Command + Shell 直接调用
│
├─ 需要新的引擎事件响应？
│   └─ 在 EVENT_SIDE_EFFECTS 表添加一行
│      └─ 需要新的副作用类型？ → 在 executors 中注册
│
├─ 需要新的组件间通信？
│   └─ 在 domain/events.ts 添加事件类型
│      └─ 发送方 emit + 接收方注册处理
│
├─ 需要新的持久化状态？
│   └─ 扩展 domain/types.ts 的 UIState
│      └─ StateManager 中添加读写逻辑
│
└─ 需要新的外部依赖？
    └─ 确认依赖方向是否合法（参考 §2.2）
       └─ 考虑使用动态 import() 减少初始加载
```

### 11.2 检查清单

每个新功能 PR 必须确认：

```
架构合规
  □ 新文件放在正确的层级目录
  □ import 路径不违反依赖矩阵（§2.2）
  □ 不直接引用其他层的实现类（通过接口或回调）

接口契约
  □ 如修改了 port 接口 → 非破坏性变更（§4.1）
  □ 如新增了事件类型 → 已添加到 domain/events.ts
  □ 如新增了持久化字段 → 已添加到 domain/types.ts

资源管理
  □ 新的 setTimeout/setInterval → 使用 TimerManager
  □ 新的 addEventListener → 使用 EventCleanup
  □ 新的 DOM 引用 → 在 destroy 中清理
  □ 新的异步操作 → 通过 ErrorHandler.wrap()

性能
  □ 不在 RAF 回调中触发同步 layout
  □ 高频操作有节流/防抖
  □ 大列表渲染使用批量 DOM 操作

文档
  □ 更新 design.md 相关章节
  □ 更新 README.md（如影响公共 API）
```

### 11.3 示例：添加"导出为 PDF"功能

```
分析：
  - 需要读取会话数据 → 涉及数据操作
  - 只有一个触发源（工具栏按钮）→ Shell 直接调用
  - 需要外部依赖（PDF 库）→ 动态 import

执行步骤：

1. commands/ExportPDFCommand.ts
   export class ExportPDFCommand extends Command<{ title: string }> {
       protected readonly name = 'Export PDF';
       protected async execute({ title }) {
           const md = this.ctx.sessionManager.exportToMarkdown();
           const { PDFExporter } = await import('@itookit/pdf');
           await PDFExporter.export(md, { title });
       }
   }

2. shell/LLMWorkspaceEditor.ts — handlePrint 旁添加
   private async handleExportPDF(): Promise<void> {
       await new ExportPDFCommand(this.buildCommandContext())
           .run({ title: this.currentTitle });
   }

3. shell/EventBinder.ts — bindNavigationEvents 中添加
   '#llm-btn-export-pdf': this.callbacks.onExportPDF,

4. components/templates/LayoutTemplates.ts — 添加按钮

影响范围：4 个文件，不修改任何接口
```

### 11.4 示例：添加新的引擎事件 `message_pinned`

```
执行步骤：

1. shell/SessionEventHandler.ts — 声明表添加一行
   const EVENT_SIDE_EFFECTS = {
       // ... 已有事件
       message_pinned: ['refreshNav', 'notifyChange'],
   };

2. 如果需要 UI 反馈 → components/history/HistoryView.ts
   case 'message_pinned': {
       const el = this.renderer.getSessionElement(event.payload.messageId);
       el?.classList.add('llm-ui-session--pinned');
       break;
   }

3. infrastructure/EventBatchProcessor.ts — 判断是否为立即事件
   如果需要立即处理 → 添加到 immediateTypes

影响范围：1-3 个文件，不修改任何接口
```

---

## 12. 重构指南

### 12.1 安全重构操作

以下操作不改变运行时行为，可以安全执行：

```
✅ 提取方法（Extract Method）— 不改变公共 API
✅ 提取类（Extract Class）— 如果原类仍然是 Facade
✅ 移动文件到正确层级 — 只改 import 路径
✅ 内联模板 → 提取到 Templates 文件
✅ 手动事件管理 → EventCleanup
✅ 裸 setTimeout → TimerManager
✅ 裸 try-catch → ErrorHandler.wrap()
```

### 12.2 危险重构操作

以下操作可能影响运行时行为，需要完整测试：

```
⚠️ 修改事件处理顺序（EventBatchProcessor 的 flush 时机）
⚠️ 修改 ScrollController 的阈值或判断逻辑
⚠️ 修改 StreamRenderPipeline 的帧率或 Phase 顺序
⚠️ 修改 destroy 顺序（可能导致空引用）
⚠️ 修改 CommandContext 的接口类型（影响所有 Command）
```

### 12.3 代码异味检测

```
异味 1: Shell 中出现 DOM 操作（querySelector, classList）
  → 应委托给 Component 的接口方法

异味 2: Command 中 import 了 components/ 下的文件
  → 应通过 CommandContext 的接口访问

异味 3: Component 中 import 了 services/ 下的文件
  → 数据应由 Shell 推送，Component 不主动拉取

异味 4: infrastructure/ 中 import 了 domain/ 或更上层
  → infrastructure 必须零业务知识

异味 5: 一个事件在 EVENT_SIDE_EFFECTS 表中找不到
  → 要么添加到表中，要么在 processEventImmediate 中处理

异味 6: 组件 destroy() 中缺少 timers.destroy() 或 events.cleanup()
  → 必须清理所有托管资源

异味 7: 在 handleBatchedEvents 或 processEventImmediate 之外处理引擎事件
  → 所有引擎事件应走统一管线
```

---

## 13. 文件命名与编码约定

### 13.1 命名规范

```
文件名：PascalCase（类文件）或 camelCase（工具文件）
  HistoryView.ts, CommandRegistry.ts
  textUtils.ts, debounce.ts

类名：PascalCase
  class SessionRenderer {}

接口名：I 前缀 + PascalCase
  interface IHistoryPresenter {}

类型名：PascalCase（无前缀）
  type CollapseStateMap = Record<string, boolean>

```markdown
事件名：kebab-case，冒号分隔命名空间
  'branch:create', 'state:collapseChanged', 'nav:scrollTo'

CSS 类名：BEM 命名
  .llm-ui-session              — Block
  .llm-ui-session__header      — Element
  .llm-ui-session--assistant   — Modifier

data 属性：kebab-case
  data-action="collapse"
  data-session-id="xxx"
  data-branch-name="main"
```

### 13.2 import 排序约定

```typescript
// 1. 外部包（按字母序）
import { Toast, showConfirmDialog } from '@itookit/common';
import { SessionManager } from '@itookit/llm-engine';

// 2. domain 层（类型优先）
import type { CollapseStateMap, BranchItem } from '../domain/types';
import type { IEditorEventBus } from '../domain/events';
import type { IHistoryPresenter } from '../domain/ports';

// 3. 同层或下层模块
import { TimerManager, EventCleanup } from '../infrastructure';
import { SessionService } from '../services';

// 4. 相对路径同目录
import { SessionRenderer } from './SessionRenderer';
import { StreamController } from './StreamController';

// 规则：
// - type import 使用 `import type`（明确标记纯类型依赖）
// - 每组之间空一行
// - 同组内按字母序排列
```

### 13.3 错误处理约定

```typescript
// ✅ 正确：通过 ErrorHandler
await this.errorHandler.wrap(
    () => this.sessionService.loadSession(nodeId, title),
    'Load session',
    'warn'
);

// ✅ 正确：Command 基类自动处理
export class MyCommand extends Command<Params> {
    protected severity: ErrorSeverity = 'toast';
    protected async execute(params: Params) {
        // 直接写业务逻辑，异常自动被 run() 捕获
    }
}

// ❌ 错误：裸 try-catch
try {
    await something();
} catch (e) {
    console.error(e);  // 吞掉错误，用户无感知
}

// ❌ 错误：在 Component 中处理业务错误
// Component 应将错误通过回调/事件上报，由 Shell 或 Command 决定处理方式
```

### 13.4 注释约定

```typescript
/**
 * 类/接口/公共方法：使用 JSDoc
 * 说明 What（做什么）和 Why（为什么这样设计）
 * 不需要说明 How（怎么做的）— 代码本身说明
 */
export class BranchStore {
    /**
     * 刷新 branch 列表
     *
     * 合并并发调用：如果已有进行中的请求，复用其结果。
     * 避免 branch_created + branch_switched 连续触发时的重复请求。
     */
    async refresh(): Promise<BranchItem[]> {}
}

// 内部逻辑：只在不显而易见时添加行内注释
// ✅ 说明 Why
// 渲染后不立即滚动，标记下一帧滚动（避免同帧 read/write 冲突）
this.scrollPending = true;

// ❌ 说明 What（代码已经表达了）
// 将 isStreaming 设为 true
this.isStreaming = true;
```

---

## 14. 生命周期管理

### 14.1 初始化顺序（严格）

```
Phase 1: 静态结构
  1. initLayout()           渲染 HTML 骨架
  2. initInfrastructure()   DOMCache, EventBus, ErrorHandler

Phase 2: 数据层
  3. initServices()         Session, State, Asset, Agent, Branch, Nav

Phase 3: UI 层
  4. initComponents()       HistoryView, ChatInput, Indicators
                            （此时可以 await 异步数据：UIState, Agents）

Phase 4: 操作层
  5. initCommands()         Command 实例化 + EventBus 绑定
  6. initEventHandler()     引擎事件 → 副作用分发器

Phase 5: 激活
  7. bindEvents()           DOM 事件 + 全局快捷键 + 全局引擎事件
  8. loadSession()          数据加载 + UI 恢复 + 会话事件订阅
  9. 后处理                  statusIndicator.cacheElements, branchIndicator.refresh
```

**约束**

```
- Phase N 中的组件只能依赖 Phase 1..N-1 中已初始化的组件
- initCommands 必须在 initComponents 之后（CommandContext 需要 View 引用）
- bindEvents 必须在 initCommands 之后（快捷键触发 Command）
- loadSession 必须在 bindEvents 之后（需要引擎事件订阅）
```

### 14.2 销毁顺序（严格逆序）

```
Phase 1: 持久化（先于任何组件销毁）
  1. StateManager.cleanup()             取消防抖定时器
  2. StateManager.saveUIState()         最后一次保存（如果允许）

Phase 2: 事件解绑（防止销毁过程中的事件触发）
  3. sessionEventUnsub()                会话事件
  4. globalEventUnsub()                 全局事件
  5. eventBinder.cleanup()              DOM 事件 + 快捷键
  6. commandRegistry.destroy()          EventBus 绑定

Phase 3: 浮动组件
  7. floatingNav.destroy()              面板 + 键盘事件

Phase 4: 基础设施定时器
  8. timers.destroy()                   Shell 自身的定时器

Phase 5: UI 组件（逆序于 initComponents）
  9.  branchIndicator.destroy()
  10. statusIndicator.destroy()
  11. historyView.destroy()             含 5 个子控制器
  12. chatInput.destroy()               含 document 级事件

Phase 6: 服务
  13. branchStore.destroy()
  14. domCache.destroy()
  15. bus.destroy()

Phase 7: 引擎
  16. sessionManager.unbindSession()

Phase 8: DOM
  17. container.innerHTML = ''
  18. listeners.clear()
  19. nodeCommands.clear()
```

**约束**

```
- 不在 destroy 中抛出异常（用 .catch(() => {}) 吞掉保存失败）
- 不在 destroy 中触发事件（EventBus 可能已被清理）
- 每个组件的 destroy 必须幂等（多次调用不报错）
- isBeingDeleted 状态下跳过持久化保存
```

### 14.3 组件销毁检查清单

```
每个实现了 destroy() 的类必须清理：
  □ TimerManager.destroy()          — 所有定时器
  □ EventCleanup.cleanup()          — 所有事件监听器
  □ ResizeObserver.disconnect()     — 如果使用了
  □ 子组件的 destroy()              — 递归清理
  □ Map/Set.clear()                 — 释放引用
  □ DOM 引用置 null                 — 帮助 GC
  □ document 级事件监听移除          — 防止泄漏
  □ 订阅取消（onChange 返回的 unsub）— 防止回调到已销毁对象
```

---

## 15. 测试要求

### 15.1 各层测试覆盖要求

| 层级 | 覆盖要求 | 测试类型 | 关注点 |
|------|---------|---------|--------|
| infrastructure | ≥ 90% | 单元测试 | 边界条件、并发、资源释放 |
| domain | 100%（纯类型） | 编译检查 | 类型正确性 |
| services | ≥ 80% | 单元 + Mock | 错误处理、边界、并发 |
| commands | ≥ 85% | 单元 + Mock 接口 | 正常流程、错误回滚、边界 |
| components | ≥ 60% | DOM 集成测试 | 渲染正确性、事件路由、销毁 |
| shell | ≥ 40% | 集成测试 | 初始化/销毁顺序、数据流 |

### 15.2 Command 测试模板

```typescript
describe('MyCommand', () => {
    let ctx: CommandContext;
    let cmd: MyCommand;

    beforeEach(() => {
        // 构造 mock CommandContext
        ctx = createMockCommandContext({
            // 只 mock 本 Command 使用的方法
            sessionManager: {
                getSessions: jest.fn().mockReturnValue([...]),
            },
            historyView: {
                removeMessages: jest.fn(),
                renderFull: jest.fn(),
            },
        });
        cmd = new MyCommand(ctx);
    });

    it('should handle normal case', async () => {
        await cmd.run({ ... });
        expect(ctx.historyView.removeMessages).toHaveBeenCalledWith(...);
    });

    it('should rollback on failure', async () => {
        (ctx.sessionManager.xxx as jest.Mock).mockRejectedValue(new Error('fail'));
        await cmd.run({ ... });
        expect(ctx.historyView.renderFull).toHaveBeenCalled();
    });

    it('should handle empty input', async () => {
        await cmd.run({ ids: [] });
        expect(ctx.sessionManager.xxx).not.toHaveBeenCalled();
    });
});
```

### 15.3 禁止的测试模式

```typescript
// ❌ 测试实现细节
expect(component['privateMethod']).toHaveBeenCalled();

// ❌ 依赖具体 DOM 结构
expect(container.querySelector('.llm-ui-node__body > div:nth-child(2)')).toBeTruthy();

// ❌ 测试中使用真实的 Timer
await new Promise(r => setTimeout(r, 2000));  // 使用 jest.useFakeTimers()

// ❌ 跨层 Mock（Mock 了不属于本层的依赖）
// Command 测试中 Mock MDxController（跨了 commands → components → mdx）
```

---

## 16. 变更日志要求

每次变更需记录以下信息：

```markdown
## [日期] 变更标题

### 类型
- [ ] 新功能
- [ ] Bug 修复
- [ ] 重构
- [ ] 性能优化
- [ ] 接口变更

### 影响层级
- [ ] infrastructure
- [ ] domain
- [ ] services
- [ ] commands
- [ ] components
- [ ] shell

### 接口变更
- 无 / 非破坏性 / 破坏性（需说明迁移方式）

### 检查清单
- [ ] 依赖方向合规
- [ ] 资源回收完整
- [ ] 文档已更新
- [ ] 测试已通过
```

---

## 附录 A: 术语表

| 术语 | 定义 |
|------|------|
| **Shell** | Composition Root，负责组装依赖和路由事件 |
| **Port** | domain/ports 中的接口，定义组件的能力契约 |
| **Command** | 封装单个操作的类，自带错误处理 |
| **Presenter** | Port 接口的 UI 实现（HistoryView implements IHistoryPresenter） |
| **Facade** | 对外暴露简化 API 的类（HistoryView 是 5 个子控制器的 Facade） |
| **Side Effect** | 引擎事件触发的响应动作（renderFull, refreshBranch 等） |
| **Optimistic Update** | 先更新 UI 再等服务端确认，失败时回滚 |
| **Guard** | 防抖函数的前置条件检查（如 isGenerating） |

## 附录 B: 快速参考

```
添加新 Command        → commands/ 新建类 + CommandRegistry 或 Shell 注册
添加新引擎事件响应    → EVENT_SIDE_EFFECTS 表添加一行
添加新 EventBus 事件  → domain/events.ts + 发送方 emit + 接收方 on
添加新组件能力        → domain/ports/ 扩展接口（可选方法）+ 实现
添加新持久化字段      → domain/types.ts UIState + StateManager 读写
添加新工具栏按钮      → templates/ + EventBinder + Shell 路由
添加新快捷键          → EventBinder.bindGlobalShortcuts()
```
    