# Skill 同步机制

> 详细设计参见 [design/skill-design.md](./design/skill-design.md)

## 双体系

| 体系 | 存储位置 | 管理器 | 作用域 |
|---|---|---|---|
| `LLMSkill` | VFS `__config:/llm/.skills/<id>.json` | `LLMDeviceDriver` | 全局 |
| `SkillDefinition` | 运行时内存 + `_agent/skills/` 目录 | `SkillDeviceDriver` | 按 `scopeLevel` |

## 同步流程

```
启动时:
  initApp()
    → LLMDeviceDriver.init() → 加载 LLMSkill[]
    → createHarness() → SkillDeviceDriver (空)
    → syncSkillsToHarness() → LLMSkill → SkillDefinition (桥接)
    → skillService.setCwd(cwd) → 扫描 _agent/skills/

运行时:
  llmDriver.onChange() → syncSkillsToHarness() → 增量同步
  CWD 变更 → setCwd() → refreshScopedSkills() → 重建 system prompt
```

## 关键转换

```
llmSkillToSkillDef(LLMSkill, SkillDefinition) {
    id, name, type, enabled, instructions → 直传
    endpoint, method, headers → SkillToolBinding
    triggerStrategy, autoLoad, priority, globs → 直传
    source: 'vfs'
}

fsSkillToSkillDef(SKILL.md frontmatter) {
    id, name, description, instructions → 直传
    scopeLevel, scopeRoot → 由目录扫描填充
    source: 'filesystem'
}
```

## Skill 类型 → 注入方式

| 类型 | 注入层 | 机制 |
|---|---|---|
| `prompt` | P3 | 自动注入 instructions |
| `http` / `shell` / `mcp` / `builtin` | P4 | 渐进披露 (id+description)，LLM 调 load_skill |
| action (disableModelInvocation) | L1 | 不注入，仅 /sk-<id> 手动调用 |

## System Prompt 优先级

```
P0: Agent systemPrompt / core identity (始终通过)
P1: 环境信息 (始终通过)
P2: loaded skills 完整 instructions
P3: prompt 型 enabled skills 完整 instructions (自动)
P4: 工具型 enabled skills id+description
预算门控: budgetTokens = 4000, P0 始终保留
```

## 关键文件

| 文件 | 职责 |
|---|---|
| `common/interfaces/skills/skill-types.ts` | SkillDefinition, SkillRouteLayer, 所有类型 |
| `common/interfaces/skills/skill-service.ts` | ISkillService |
| `llm-harness/src/drivers/skill-device-driver.ts` | 实现 ISkillService + 四层路由 |
| `llm-harness/src/executor/context-manager.ts` | ContextManager.buildSystemPrompt() |
| `llm-harness/src/skills/fs-skill-loader.ts` | 文件系统扫描 + 作用域继承链 |
| `llm-harness/src/skills/compact-extractor.ts` | Compact Instructions 提取 |
| `app-shell/src/bootstrap.ts` | syncSkillsToHarness() |
| `device-llm/src/device/llm-device-driver.ts` | VFS skill CRUD |
