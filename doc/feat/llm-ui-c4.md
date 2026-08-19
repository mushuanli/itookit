# llm-ui 架构 C4 分析 + 五优先级的提升路径

> 用 C4（Context/Container/Component）梳理 llm-ui 当前结构，标注 P1–P5 的落点，并给出目标架构与**全部未完成项**清单。

## 0. 未完成项总清单（诚实盘账）

| 范围 | 未完成 | 状态 |
|---|---|---|
| llm-ui P1 | 拆 `ChatInputView`(1589) + `LLMWorkspaceEditor`(1057) | 未做 |
| llm-ui P2 | `SessionEventHandler` 的 `as any` + 事件流三路收敛 | 空 executor 已删；边界类型未修 |
| llm-ui P3 | 拆 `editors/`(~4000 行) 为独立包 | 未做 |
| llm-ui P5 | 38 处 `any` + `✅` 历史注释 | console 已清零；any/注释未做 |
| harness | `harness.ts`(696) 未拆成 TaskScheduler/EffectDispatcher/ResourceManager 协调器 | 仅抽了 utils |
| harness | `store.ts`(936) 未按聚合根拆 TaskStore/EffectStore/ResourceStore | 仅抽了 store-helpers |
| doc | `doc/readme.md` 已删除（旧架构），文档入口见 `CLAUDE.md` 项目文档表 | 已完成 |

> 已完成（本会话）：llm-ui P4（TokenStats→SessionTokenUsage）、P5 console、P2 空 executor；以及此前 harness/upper-layers 的全部下沉项 + 预算扣减 + 包拆分重命名。

---

## 1. C1 系统上下文

```mermaid
C4Context
    title llm-ui - 系统上下文
    Person(user, "用户", "编辑 / 对话 / 配置 / 运行")
    System(ui, "llm-ui", "Conversation 展示 + Run 控制（不直接控制 Engine）")
    System(session, "llm-session", "会话语义 + 持久化 + 编排")
    System(flow, "llm-flow", "DAG 编排")
    System(programs, "llm-programs", "LLM 任务单元")
    System(harness, "harness", "执行内核（TaskHandle / EventEnvelope）")
    System(shell, "app-shell", "装配 + 注入依赖")
    System_Ext(editor, "ui-common / mdxeditor", "Editor 契约 + Asset 管理")
    Rel(user, ui, "输入 / 触发 Run / 浏览分支 / 配置")
    Rel(ui, session, "SessionEvent / IChatEngine / SessionManager")
    Rel(ui, harness, "TaskHandle attach / events / signal / cancel")
    Rel(shell, ui, "createLLMFactory 注入 agentService/harness/chatEngine")
    Rel(ui, editor, "实现 IEditor 契约")
    Rel(session, flow, "编排 DAG")
    Rel(flow, programs, "agent 节点委托")
    Rel(programs, harness, "提交 TaskSpec")
```

**边界（正确）**：llm-ui 只依赖 `presenter` 接口 + `llm-session` 公开句柄 + `harness` 的 `TaskHandle`，不 import DAG Runtime 内部。

---

## 2. C2 容器（llm-ui 内部）

```mermaid
C4Container
    title llm-ui 容器
    Person(user, "用户")
    Container(domain, "domain/", "纯契约", "types / events / ports")
    Container(services, "services/", "数据访问", "SessionService / StateService / BranchStore / NavDataBuilder")
    Container(components, "components/", "DOM 视图", "ChatInput / History / Dag / 模板")
    Container(shell, "shell/", "编排", "LLMWorkspaceEditor / StateManager / SessionEventHandler / SlashCommandRouter")
    Container(commands, "commands/", "命令", "CommandRegistry / BranchCommands / WorkspaceCommands")
    Container(editors, "editors/", "设置应用 ~4000 行", "Agent / Provider / Connection / MCP / Skill / Cost")
    Container(utils, "utils/", "纯工具", "debounce / iconResolver / errorHandler")
    Rel(user, components, "交互")
    Rel(components, shell, "回调 / 事件")
    Rel(shell, services, "查询 / 持久化")
    Rel(shell, domain, "依赖接口")
    Rel(shell, commands, "命令路由")
    Rel(shell, editors, "打开设置编辑器")
    Rel(components, domain, "实现端口")
    Rel(commands, domain, "依赖端口")
    UpdateElementStyle(editors, $bgColor="#fbb")
    UpdateElementStyle(components, $bgColor="#fbb")
    UpdateElementStyle(shell, $bgColor="#fda")
```

**问题标注**：`editors` 是「另一个应用」；`components.ChatInput` 和 `shell.LLMWorkspaceEditor` 是两个上帝对象。

---

## 3. C3 组件（P1–P5 落点）

```mermaid
C4Component
    title llm-ui 组件 - 五优先级落点
    Container_Boundary(shell_b, "shell/ 编排") {
        Component(lwe, "LLMWorkspaceEditor", "1057 行", "P1：拆上帝对象")
        Component(seh, "SessionEventHandler", "事件→副作用", "P2：单一声明式表")
        Component(sm, "StateManager", "UI 状态")
        Component(scr, "SlashCommandRouter", "slash 路由")
    }
    Container_Boundary(comp_b, "components/ 视图") {
        Component(ci, "ChatInputView", "1589 行", "P1：拆设置/连接/tool-output")
        Component(hv, "HistoryView", "流式历史")
        Component(dw, "DagWorkbench", "DAG 可视化")
    }
    Container_Boundary(ed_b, "editors/ 设置") {
        Component(ae, "AgentConfigEditor", "943 行", "P3：拆独立包")
        Component(pe, "ProviderSettingsEditor", "902 行", "P3")
        Component(ce, "ConnectionSettingsEditor", "774 行", "P3")
    }
    Container_Boundary(dom_b, "domain/ 契约") {
        Component(types, "types.ts", "P4：re-export", "P5：去 any")
        Component(ports, "ports/", "ISP 接口")
    }
    Rel(lwe, ci, "P1：解耦")
    Rel(lwe, seh, "事件入口")
    Rel(seh, hv, "processEvent")
    Rel(ci, types, "P4/P5")
```

---

## 4. 目标架构（提升后）

```mermaid
C4Component
    title llm-ui 目标架构
    Container_Boundary(shell_b, "shell/ 编排（瘦编排器）") {
        Component(lwe, "LLMWorkspaceEditor", "装配 + 生命周期（<400 行）")
        Component(seh, "SessionEventHandler", "单一声明式事件→副作用表（含 payload 执行器）")
    }
    Container_Boundary(comp_b, "components/（按关注点拆）") {
        Component(ci_core, "ChatInputCore", "输入框 + 插件宿主")
        Component(ci_settings, "ChatSettingsPanel", "连接/tier/history/stream/flow（独立控制器）")
        Component(ci_tool, "ToolOutputPanel", "内联工具输出")
    }
    Container_Boundary(ed_b, "settings-ui（独立包）") {
        Component(agent, "AgentConfigEditor")
        Component(prov, "Provider/Connection/MCP/Skill/Cost")
    }
    Container_Boundary(sess_b, "llm-session（边界修复）") {
        Component(env, "SessionEventEnvelope", "统一 {type,payload} 类型（修 P2 根因）")
    }
    Rel(lwe, ci_core, "委托")
    Rel(ci_core, ci_settings, "组合")
    Rel(seh, env, "类型对齐，去 as any")
```

**目标要点**：
1. `LLMWorkspaceEditor` 从 1057 → 纯装配器；`ChatInputView` 从 1589 → 核心 + 设置面板 + 工具输出三块。
2. `SessionEventHandler` 用「事件→执行器函数」的单一映射（payload 直接作为执行器入参），消除三路处理 + `as any`。
3. `SessionEventBus` 引入 `SessionEventEnvelope` 类型，让边界类型一致。
4. `editors/` 独立为 `llm-settings-ui`。
5. 类型 re-export + 去 `any`。

---

## 5. 建议执行顺序（单一切口逐步验证）

1. **P2 根修**：llm-session 引入 `SessionEventEnvelope`，SessionEventHandler 去 `as any`（范围最小、修根因）。
2. **P1 第一刀**：ChatInputView 抽出 `ChatSettingsPanel`（`bindSettingsEvents` ~140 行 + 相关 DOM 字段）。
3. **P1 第二刀**：ChatInputView 抽出 `ToolOutputPanel`（`showToolOutput`/`clearToolOutput`）。
4. **P1 收尾**：LLMWorkspaceEditor 精简为纯装配。
5. **P3**：`editors/` → `llm-settings-ui` 包。
6. **P5 收尾**：`✅` 历史注释 + 剩余 `any`。
7. **harness 深拆**：harness.ts 协调器化、store.ts 聚合根化（另一条线，独立推进）。
