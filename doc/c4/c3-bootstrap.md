# C3 - 引导与应用层组件图 (v4.1 优化后)

## app-shell — initApp() 引导序列

```
1. createVFS({ rootBackend, modules })
   → 创建 VFS 引擎 + 注册存储后端 + 挂载模块

2. new LLMDeviceDriver(vfs) → init() → vfs.devices.register()
   → 初始化 LLM 设备驱动 + 创建设备节点 (/dev/llm)

3. createSettingsModule(vfs)
   → 创建设置模块 (SettingsEngine + SkillsEngine)

4. new VFSAgentService(vfs, llmDriver)
   → Agent 配置 VFS 持久化服务 (实现 IConnectionReader)

5. createHarness({ llmDriver, ttyDriver? })
   → 装配多轮 Agent 循环 (AgentLoopExecutor + 工具 + 设备驱动)

5b. LLMUIEditors 注入
   → app-shell 导入 llm-ui 编辑器类 → 注入给 app-settings
   → 解耦 app-settings→llm-ui 上行依赖

6. harness.toolDriver.setVFSContext(createVFSToolContext(vfs))
   → 浏览器 VFS 桥接

7. syncSkillsToHarness(llmDriver, harness)
   → Skill 直接传递 (LLMSkill = SkillDefinition，无需转换)

8. initializeLLMEngine({ ... })
   → → SessionManager + 工作区策略装配 + Hash 路由
```

## app-settings — 设置模块

| 组件 | 职责 |
|---|---|
| `createSettingsModule()` | 设置模块入口 |
| `SettingsEngine` | 设置读取/写入引擎 |
| `SkillsEngine` | 技能引擎（导入/导出/启用/禁用） |
| `SystemVFSEngine` | 跨模块只读 VFS 浏览 |
| `LLMUIEditors` | llm-ui 编辑器注入接口（无上行依赖） |

> **已优化**: 删除 `@itookit/llm-ui` peerDependency，编辑器通过 `LLMUIEditors` 注入

## Skill 同步简化

| 优化前 | 优化后 |
|---|---|
| `LLMSkill` (VFS 持久化) + `SkillDefinition` (harness 运行时) 双体系 | `LLMSkill = SkillDefinition` 类型别名 |
| `llmSkillToSkillDef()` 43 行字段映射 | 直接传递，无转换 |
| `syncSkillsToHarness()` 含转换逻辑 | `syncSkillsToHarness()` 直接 `saveSkill(s)` |
