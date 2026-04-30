# 跨包事件流

## Agent 事件 → UI 更新

```
llm-harness/AgentLoopExecutor
  → emit agent:stream:content { delta }
    → llm-engine/HarnessAdapter (单例)
      → node_update { field: 'output', nodeId }
        → llm-ui/StreamController
          → HistoryView 增量更新
```

## VFS 事件 → UI 刷新

```
vfslib/VFSEngine
  → emit node:created { nodeId, path }
    → vfslib/VFSManager
      → emit node:created { nodeId, path, moduleId }
        → vfs-ui/EngineAdapter
          → VFSUIShell → NodeList 刷新
```

## VFS 变更 → LLMSkill 同步

```
device-llm/LLMDeviceDriver
  → onChange() (用户编辑了 Skill)
    → app-shell/syncSkillsToHarness()
      → 读取 VFS 中的 LLMSkill[]
      → llmSkillToSkillDef() 转换
      → harness.skillService.saveSkill() / deleteSkill()
```

## HITL 事件流

```
Agent 调用 human_input → HITLQueue.push() [阻塞]
  → onRequest → emit('agent:human:input')
    → HarnessAdapter → node_update(metaInfo.hitlRequest)
      → TaskRunner:
        ├─ isBound → session event → HarnessPlugin HITL 横幅
        └─ !isBound → session_hitl_active → vfs-ui 橙色指示器

用户响应 → runtime.respondToHumanInput()
  → HITLQueue.resolve() → Agent 继续执行
```

## TTY 事件流

```
Agent 调用 shell_session → NodeTTYDriver.spawn()
  → agent:tty:open/data/close 事件
    → TtyController → TtyPanel (内联终端 widget)
      → 用户输入 → runtime.ttyWrite() → process stdin
```
