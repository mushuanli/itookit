# 关键文件快速索引

| 场景 | 查找 |
|---|---|
| 理解某个接口 | `packages/common/src/interfaces/` |
| 理解 VFS 如何工作 | `packages/vfslib/src/engine/vfs-engine.ts` → `services/module-fs.ts` |
| 理解 Agent 循环 | `packages/llm-harness/src/executor/agent-loop-executor.ts` |
| 理解 Chat 持久化 | `packages/llm-engine/src/persistence/session-engine.ts` |
| 理解启动流程 | `packages/app-shell/src/bootstrap.ts` |
| 理解 Skill 系统 | `packages/llm-harness/src/drivers/skill-device-driver.ts` |
| 理解 Mission 编排 | `packages/llm-engine/src/mission/mission-scheduler.ts` |
| 添加新工作区 | `apps/web-app/src/config/modules.ts` → WORKSPACES |
| 添加文件类型 | `packages/app-shell/src/config/file-registry.ts` → FILE_REGISTRY |
