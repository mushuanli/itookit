# LLM Workspace Editor (`llm-ui`)

LLM 对话工作区编辑器 — 支持多分支对话、流式输出、会话持久化的富交互 UI 组件。

## 功能概览

- **多分支对话** — 从任意消息创建分支，自由切换对话路径
- **流式输出** — 实时渲染 LLM 响应，支持 Markdown / 代码块 / 数学公式 / Mermaid
- **会话管理** — 编辑、重新生成、删除消息，批量操作
- **状态持久化** — 折叠状态、输入内容、Agent 选择自动保存恢复
- **浮动导航** — 快速跳转、批量选择、分支筛选
- **附件系统** — 拖拽/粘贴上传，内联引用

## 架构设计

### 分层架构（Layered Shell Architecture）

```
Layer 0  infrastructure/    零业务知识的基础设施
Layer 1  domain/            类型定义 + 接口契约（ports）
Layer 2  services/          数据操作、持久化、引擎交互
Layer 3  commands/          操作编排，面向 domain/ports 接口
Layer 4  components/        UI 组件，实现 domain/ports 接口
Layer 5  shell/             组装、路由、生命周期
```

**核心规则：依赖只能从外层指向内层，绝不反向。**

### 目录结构

```
llm-ui/
├── index.ts                    # 公共 API（工厂函数）
├── infrastructure/             # Timer, Event, Scroll, DOM 缓存等
├── domain/                     # 纯类型 + 接口
│   ├── types.ts                #   NodeAction, BranchItem, CollapseStateMap...
│   ├── events.ts               #   EditorBusEvents, IEditorEventBus
│   └── ports/                  #   IHistoryPresenter, IChatInputPresenter...
├── services/                   # SessionService, StateService, BranchStore...
├── commands/                   # SendMessage, Branch, Node, Batch 命令
├── components/                 # UI 实现
│   ├── history/                #   HistoryView + 5 个子控制器
│   ├── input/                  #   ChatInput
│   ├── indicators/             #   Branch / Status 指示器
│   ├── navigation/             #   FloatingNavPanel
│   ├── mdx/                    #   MDxController（编辑器封装）
│   └── templates/              #   HTML 模板
├── shell/                      # LLMWorkspaceEditor（Composition Root）
├── utils/                      # 工具函数
└── styles/                     # CSS
```

### 关键设计决策

| 决策 | 理由 |
|------|------|
| Shell 只持有接口引用 | 数据/UI 变更互不波及 |
| Command 面向 `domain/ports` | 可独立测试，不依赖 DOM |
| EventBus 实例级（非全局） | 多编辑器实例互不干扰 |
| 副作用声明表驱动事件处理 | 新增事件只改表，不改逻辑 |
| Infrastructure 泛化 | `EventBatchProcessor<T>` 可复用于任何事件流 |

### 数据流

```
用户操作 → EventBus/Callback → Command → SessionManager → Engine
                                              ↓
Engine Event → SessionEventHandler → 副作用声明表 → View 更新
                                                  → State 持久化
                                                  → 导航刷新
```

## 维护要点

### 新增功能检查清单

1. **新增消息操作** → `commands/` 下新建 Command 类，注册到 `CommandRegistry`
2. **新增 UI 事件** → `domain/events.ts` 添加类型，`CommandRegistry` 绑定处理
3. **新增引擎事件** → `shell/SessionEventHandler.ts` 的 `EVENT_SIDE_EFFECTS` 表添加一行
4. **新增 View 能力** → 先在 `domain/ports/` 扩展接口，再在 `components/` 实现

### 依赖规则（CI 可检查）

```
infrastructure/  →  禁止 import domain/ services/ commands/ components/ shell/
domain/          →  禁止 import 任何实现层（只允许 type import 外部包）
services/        →  禁止 import components/ shell/ commands/
commands/        →  禁止 import components/ shell/（只依赖 domain/ports）
components/      →  禁止 import shell/ commands/ services/
```

### 性能敏感区域

| 区域 | 机制 | 注意事项 |
|------|------|---------|
| 流式渲染 | `StreamRenderPipeline` RAF 循环 | 内容 flush 间隔 250ms，滚动在下一帧 |
| 事件批处理 | `EventBatchProcessor` 合并 chunk | 自适应间隔 30-150ms |
| 状态持久化 | `StateManager` 防抖 | UI 状态 2s，输入 1s，生成中跳过 |
| 分支刷新 | `BranchStore` 并发合并 | 连续事件只触发一次请求 |
| DOM 查询 | `DOMCache` WeakRef | 元素移除后自动失效 |
| 滚动控制 | `ScrollController` 程序滚动标记 | 150ms 窗口内不更新用户状态 |

### 常见修改场景

**修改数据格式**
```
domain/types.ts → services/ 适配 → 完成
（components/ 和 commands/ 通过接口隔离，无需修改）
```

**替换 UI 框架**
```
实现 domain/ports/ 中的 5 个接口 → shell/ 构造时注入新实现 → 完成
```

**添加新的快捷键**
```
shell/EventBinder.ts → bindGlobalShortcuts() 添加映射
```

## 公共 API

```typescript
import { createLLMFactory } from '@itookit/llm-ui';

const factory = createLLMFactory(agentService);
const editor = await factory(container, {
    title: 'New Chat',
    sessionEngine: engine,
    initialInputState: {
        text: '请帮我分析...',
        agentId: 'my-agent'
    }
});
```

```
┌─────────────────────────────────────────────────────────────┐
│                        index.ts                              │
│                     (公共 API 不变)                           │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│                    shell/ (Layer 5)                           │
│  LLMWorkspaceEditor  SessionEventHandler  StateManager       │
│  EditorEventBus      EventBinder                             │
│                                                              │
│  职责：组装、路由、生命周期                                     │
│  依赖：domain/ports (接口), services, commands, components    │
│  规则：只通过接口引用 components，构造时注入                     │
└──┬──────────┬──────────┬──────────┬─────────────────────────┘
   │          │          │          │
   ▼          ▼          ▼          ▼
┌──────┐ ┌────────┐ ┌────────┐ ┌──────────────────────────────┐
│compo-│ │commands│ │services│ │     domain/ (Layer 1)         │
│nents │ │(Lay 3) │ │(Lay 2) │ │  types.ts  events.ts         │
│(Ly 4)│ │        │ │        │ │  ports/                      │
│      │ │        │ │        │ │    IHistoryPresenter          │
│      │ │        │ │        │ │    IChatInputPresenter        │
│      │ │        │ │        │ │    IStatusPresenter           │
│      │ │        │ │        │ │    IBranchPresenter           │
│      │ │        │ │        │ │    INavigationPresenter       │
│      │ │        │ │        │ │                               │
│  ┌───┘ └───┬────┘ └───┬────┘ │  规则：纯类型，零实现，零依赖   │
│  │         │          │       └──────────────────────────────┘
│  │         │          │                    
   │         │          │
   │         ▼          │
   │    CommandContext   │
   │    只依赖 ports/   │
   │    接口 + services │
   │         │          │
   ▼         ▼          ▼
┌──────────────────────────────────────────────────────────────┐
│                infrastructure/ (Layer 0)                      │
│                                                              │
│  TimerManager     EventCleanup      DOMCache                 │
│  ScrollController ContentResizeTracker                       │
│  StreamRenderPipeline  EventBatchProcessor                   │
│                                                              │
│  规则：零业务知识，只依赖浏览器原生 API                         │
│  任何文件都不允许 import domain/ services/ commands/ 等        │
└──────────────────────────────────────────────────────────────┘


依赖方向（严格单向）：

  shell → commands → domain/ports (接口)
    ↓        ↓              ↑
  components  services      │
    ↓        ↓              │
    └────────┴──── domain/types (只有类型)
                      ↑
  infrastructure ─────┘ (不允许反向依赖)
```

### 各层依赖规则总结

| 层级 | 允许依赖 | 禁止依赖 |
|------|---------|---------|
| **infrastructure** | 浏览器 API | domain, services, commands, components, shell |
| **domain** | 无（纯类型） | 任何实现层 |
| **services** | domain/types, infrastructure, @itookit/llm-engine | components, shell, commands |
| **commands** | domain/ports, domain/types, services, infrastructure | components, shell |
| **components** | domain/ports, domain/types, infrastructure, templates | shell, commands, services |
| **shell** | 全部（组装层） | 无限制，但只在构造时引用 components 具体类 |

---
