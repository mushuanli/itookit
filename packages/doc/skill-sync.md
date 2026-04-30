# 双 Skill 体系同步

系统中存在两套独立的 Skill 存储体系，必须在 `app-shell` 中保持同步：

```
LLMSkill (VFS 持久化, device-llm)
  ├─ 位置: __config:/llm/.skills/<id>.skill.yml
  ├─ 内容: id, name, type, enabled, instructions, endpoint, command...
  ├─ 管理者: LLMDeviceDriver (通过 ioctl CRUD)
  └─ 变更通知: llmDriver.onChange()

        ↓ syncSkillsToHarness() 转换 ↓

SkillDefinition (运行时内存, llm-harness)
  ├─ 位置: SkillDeviceDriver 内存 Map
  ├─ 内容: id, name, type, enabled, instructions, tools[], triggerPatterns...
  ├─ 管理者: SkillDeviceDriver (loadSkill / unloadSkill)
  └─ 使用: ContextManager.buildSystemPrompt() 注入 P2/P3/P4
```

**同步触发时机：**
1. `initApp()` 启动时 — 全量同步
2. `llmDriver.onChange()` — 增量同步（用户增删改 Skill）

**System Prompt 注入归属：** `ContextManager` 独占，`AgentResolver` 不注入。
