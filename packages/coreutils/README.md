# @itookit/coreutils

Kernel 外部能力公共包。提供 LLM、Tool、Skill load、Bash、TTY 的抽象端口、平台无关公共实现和 Durable Effect 适配器。

`@itookit/kernel` 只负责调度、状态和资源管理；本包通过 `KernelPlugin` 注册外部能力。

## 目录

```text
src/
  effects/  Durable Effect adapters
  plugin/   CoreutilsKernelPlugin
  ports/    application-injected capability contracts
  programs/ Durable Interaction programs
  runtime/  session-scoped capability assembly
  llm/      platform-neutral LLM device adapter
  skill/    platform-neutral Skill registry and routing
  tool/     runtime-bound tools
  tty/      interactive shell tools
```

本包不包含 Node、Browser 或 Tauri 平台实现，不得导入 `node:*`、Tauri API 或直接执行 `fetch`。平台能力由 `apps/*` 创建并通过 `CoreutilsRuntimeOptions` 注入。

## 使用

```ts
const coreutils = await createCoreutilsRuntime({ llmDriver, ttyDriver });
const kernel = new Kernel({ catalog });
await kernel.use(coreutils.plugin);
```

插件按可用服务注册 `llm.chat`、`tool.call`、`process.exec`、`tty.command`、`skill.load`，并注册 `coreutils.approved-effect` Durable Program。能力状态按 Kernel Session 隔离；Skill 加载集合写入 Session shared state；TTY 操作必须持有对应 `ResourceHandle(execute)`。无法确认外部副作用的 Bash/TTY 恢复会进入 `indeterminate`，不会盲目重复执行。

## Skill 执行边界

Skill 是 manifest、指令、assets、工具和可选 TaskProgram 的能力包，不统一压缩成
Effect。加载或单次外部调用使用 Effect；多步、有状态、需要等待或审批的 Skill 在
manifest 中声明 `taskProgram`，并编译成 Durable Task：

```ts
const spec = createSkillTaskSpec(skill, { path: 'src/index.ts' });
const task = await session.submit(spec);
const workspace = await task.createResource({
  kind: 'workspace', uri: 'workspace://skill', rights: ['read', 'write'],
});
await task.signal({
  type: 'capabilities', payload: { workspaceHandleId: workspace.handle.id },
});
await task.start();
```

`createSkillTaskSpec` 默认设置 `deferStart=true`，便于在调度前绑定 ResourceHandle。
TaskProgram 由 Skill 插件注册；Coreutils 不执行或解释 Skill 私有状态机。
