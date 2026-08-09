# C2 - 容器图 (v4.1 优化后)

## 分层架构

```
┌─────────────────────────────────┐
│     引导/应用层                   │
│  app-shell  |  demo             │
│  (注入 LLMUIEditors ↓)          │
├─────────────────────────────────┤
│     UI 层                       │
│  memory-manager | llm-ui |      │
│  vfs-ui        | mdxeditor     │
├─────────────────────────────────┤
│     业务层                       │
│  llm-runtime | llm-harness |     │
│  app-settings (无 llm-ui 依赖)   │
├─────────────────────────────────┤
│     引擎层                       │
│  stdio | device-llm |          │
│  llm-runtime (task-runner + executor)   │
│  tools | device-tty             │
├─────────────────────────────────┤
│     存储驱动层                    │
│  vfsdriver-indexeddb |          │
│  vfsdriver-localfs              │
├─────────────────────────────────┤
│     接口层 (零依赖)              │
│  @itookit/common                │
│  IConnectionReader · SkillDef   │
└─────────────────────────────────┘
```

## 关键优化

| 优化 | 说明 |
|---|---|
| **TaskGraph v3** | 统一控制面，DAG 依赖调度 + Artifact 数据流 |
| **Skill 类型统一** | LLMSkill = SkillDefinition（类型别名），消除双体系 |
| **IConnectionReader** | 连接只读接口，IAgentConfigService 和 IConnectionService 共用 |
| **app-settings 解耦** | 不再上行依赖 llm-ui，编辑器通过 LLMUIEditors 注入 |
| **HITLQueue 统一** | 仅保留 llm-harness 版本（正确 reject on abort） |
| **接口归位** | SRS→mdx、IAutocompleteSource/IMentionSource→vfs-ui |
| **共享调度核心** | llm-runtime/scheduler/ 提取 getReadyItems/topologicalSort |

## 包依赖关系表

### 业务层
| 包 | 内部依赖 | 外部依赖 |
|---|---|---|
| `@itookit/llm-harness` | common, device-llm, device-tty, tools | 无 |
| `@itookit/llm-runtime` | common, stdio | `yaml` |
| `@itookit/app-settings` | common, device-llm, llm-runtime, memory-manager | `js-yaml` |

> **变更**: app-settings 不再依赖 llm-ui（上行依赖已解耦）
