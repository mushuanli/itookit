# C4 架构图 — itookit 项目 (v4.1 优化后)

## 图结构概览

```
C1 — 系统上下文         c1-context.puml / .md    用户 + 外部系统
  │
C2 — 容器图             c2-containers.puml / .md  18 个包的层级总览
  │
  ├── C3 — VFS 子系统           c3-vfs.puml / .md          存储后端 + 引擎 + ModuleFS
  ├── C3 — LLM 子系统           c3-llm.puml / .md          device-llm / kernel / harness / engine
  ├── C3 — UI 层               c3-ui.puml / .md            llm-ui / vfs-ui / mdx / memory-manager
  └── C3 — 引导层               c3-bootstrap.puml / .md     app-shell / app-settings / demo
        │
        └── C4 — Agent 循环流程       c4-agent-loop.puml          多轮 agent 执行
        └── C4 — 引导序列             c4-bootstrap-sequence.puml   initApp() 9 步 (含 LLMUIEditors 注入)
        └── C4 — Session 执行路径      c4-session-execution.puml  双路径 + Mission + Session Graph
```

## 文件清单

| 级别 | 文件名 | 格式 | 内容 |
|---|---|---|---|
| C1 | `c1-context` | .puml + .md | 系统上下文：用户、LLM API、MCP、文件系统、同步服务器 |
| C2 | `c2-containers` | .puml + .md | 18 个包分层架构 + v4.1 依赖关系优化 |
| C3 | `c3-vfs` | .puml + .md | VFS 子系统：存储后端、VFSEngine、ModuleFS、文件句柄 |
| C3 | `c3-llm` | .puml + .md | LLM 子系统：device-llm/llm-kernel/llm-harness/llm-engine |
| C3 | `c3-ui` | .puml + .md | UI 层：llm-ui/vfs-ui/mdx/memory-manager + 接口归位 |
| C3 | `c3-bootstrap` | .puml + .md | 引导层：app-shell/app-settings/demo + LLMUIEditors 注入 |
| C4 | `c4-agent-loop` | .puml | Agent 循环详细执行流程 |
| C4 | `c4-bootstrap-sequence` | .puml | initApp() 引导序列 (含注入点) |
| C4 | `c4-session-execution` | .puml | Session 双路径 + Mission + 依赖图 |
| - | `c4-interactions` | .md | 代码级交互文本说明 |

## 生成 PNG 图

```bash
for f in doc/c4/*.puml; do
  plantuml "$f" -tpng -o .
done
```

## v4.1 优化要点

| 优化 | 影响图 |
|---|---|
| llm-kernel Orchestrator 删除 | C2、C3-LLM |
| Skill 类型统一 (LLMSkill=SkillDefinition) | C2、C3-LLM、C3-Bootstrap、C4-Bootstrap |
| IConnectionReader 接口提取 | C2、C3-LLM |
| app-settings ↔ llm-ui 解耦 | C2、C3-UI、C3-Bootstrap、C4-Bootstrap |
| HITLQueue 统一 | C3-LLM |
| 死接口清理 | C2、C3-UI |
| 共享调度核心 | C3-LLM |

## 核心架构原则

1. **分层单向依赖** — 下层不知道上层存在
2. **接口隔离** — 跨包契约全部在 `@itookit/common` 中定义，单消费者接口已归位
3. **ModuleFS 隔离** — 每个模块 chroot 到 `/module/<name>/`
4. **LLM 双路径** — Kernel 单轮 / Harness 多轮 agent 循环
5. **事件驱动** — Agent 事件 → HarnessAdapter → UI 渲染
6. **VFS 持久化** — Agent 配置/Skill/对话/Mission 全部通过 VFS 存储
7. **依赖注入** — 上行依赖通过接口注入解耦（如 LLMUIEditors）
