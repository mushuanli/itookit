# @itookit/app-core

平台无关的**应用装配层**：把 VFS / LLM 设备驱动 / durable-kernel / kernel-adapters / llm-session / llm-flow 装配成可运行的 MindOS 运行时，供 Tauri、Web 与 CLI 共用。详见 [运行时架构](../../doc/runtime-architecture.md)、[包结构](../../doc/pkgstructure.md)。

## 定位与铁律

- **平台无关**：`src/` 内不出现 `node:*`、DOM、`window`、`localStorage`；宿主差异一律通过注入传入（`ApplicationKernelPlatform`：`createSessionProcesses` / `skillSourceForSession` / `configureSession` / `configure`）。
- **依赖只朝下**：只依赖 `common`、`vfs-core`、`durable-kernel`、`kernel-adapters`、`llm-flow`、`llm-session`、`device-llm`；不得依赖 `app-shell`、UI 包或任何 app。
- **装配不是策略**：这里只做「接线 + 生命周期」。宿主策略（租约文案、挂载守卫、恢复时机）应能被宿主替换；新增这类逻辑时优先放进可单测的服务模块，而不是 `createApplicationRuntime` 内联。
- 无构建脚本：`main` 直接指向 `src/index.ts`，由宿主 app（web-app / tauri-app / cli）打包。

## 结构

```
src/
├── index.ts                     统一导出（含历史别名 createMindOSRuntime/MindOSRuntime）
├── runtime/
│   ├── create-kernel-runtime.ts 平台无关 Kernel 组合：Kernel + kernel-adapters + Durable programs
│   └── create-application-runtime.ts 应用运行时装配：VFS → LLM → 会话/Flow → 租约与恢复 → RunCatalog
├── files/                       Session 文件/挂载域服务
│   ├── session-files.ts         Session 命名空间（revision CAS + per-session 串行队列）
│   ├── directory-mounts.ts      宿主目录挂载（DirectorySourceProvider 端口）
│   ├── session-attachments.ts   Session 附件挂载
│   ├── session-process-context.ts Session 进程上下文（native shell/tty 注入点）
│   ├── session-lifecycle.ts     Session 删除顺序与有界等待
│   ├── session-bundle.ts        会话导出/导入格式（带版本与校验）
│   ├── session-browser.ts       浏览器侧导航模型（folder:/tasks 目标解析与投影）
│   ├── session-route.ts         路由解析
│   ├── tool-context.ts          工具可见 VFS 上下文（readFile/writeFile/listFiles/stat）
│   ├── unavailable-directory.ts 挂载源缺失时的占位目录
│   └── workspace-paths.ts       /home/admin/<name> 工作区路径
├── kernel/
│   ├── session-lease.ts         Session 单写者租约（CAS + fencingToken，默认 TTL 60s）
│   ├── sync-skills.ts           Skill catalog → Kernel 同步
│   └── privileged-command-service.ts 受限 plan/exec 命令
├── profile/mindos-profile.ts    数据根解析（mindos.json#rootDir）
├── run/
│   ├── run-definition.ts        RunDefinition 契约 + FlowRevision 编译
│   └── run-catalog.ts           Run 目录投影（flow-root 任务）
└── core/WorkspaceController.ts  工作区控制器接口
```

## 入口

```ts
// 完整应用运行时（Tauri / Web / CLI 共用）
const runtime = await createApplicationRuntime({ backend, additionalMounts, ownerKind, kernelPlatform });

// 只要 headless Kernel（CLI 子 harness 等）
const kernel = await createKernelRuntime({ systemFS, llmDriver, storageResolver, recover: false });
```

`createApplicationRuntime` 的顺序是：VFS → LLM 驱动 → 核心服务（agent/flow/session files/mounts）→ `createKernelRuntime` → 逐个 Session 取租约并 `recoverSession` → 会话系统（`initializeConversationSystem`）→ 默认 Flow 播种 → `RunCatalog`。释放走 `cleanupFns` 逆序 + `AggregateError`。

## 约束

- Session 与 Kernel 的所有写入都必须先持有 Session 租约（`SessionLeaseStore`）；拒租只让该 Session 保持只读，不影响其他 Session。
- 修改挂载前必须确认该 Session 没有未结束的 Task（`mountGuard`）。
- 用户可见文案不写在本包：抛结构化错误，由宿主/i18n 层处理。
- 长耗时启动步骤应经 `traceBoot`/`logStep` 暴露进度，便于宿主显示启动状态。

## 运行

```bash
pnpm --filter @itookit/app-core test        # vitest：目前 3 文件 / 10 用例
pnpm --filter @itookit/app-core typecheck
```

> 注意：本包多数模块的测试目前位于 `packages/app-shell/tests`（`session-files`、`session-browser`、`directory-mounts`、`session-bundle`、`privileged-command-service`、`session-delete-lifecycle` 等），并经 app-shell 的兼容 re-export 导入；改动本包时只跑 `app-core` 的测试会出现假绿灯。搬迁计划与其余包内技术债见 [todo P2-06](../../doc/todo.md)。

## 相关文档

| 文档 | 内容 |
|---|---|
| [运行时架构](../../doc/runtime-architecture.md) | 装配顺序、端口注入、headless Kernel 组合 |
| [接口契约](../../doc/interface-contracts.md) | 跨包接口与实现/消费关系 |
| [VFS Session 挂载访问边界](../../doc/design/vfs-session-mount-access.md) | 命名空间、挂载与授权语义 |
| [Session 浏览](../../doc/design/vfs-session-browser.md) | `session-browser` 的路由与投影契约 |
| [MindOS profile](../../doc/mindos-profile.md) | 数据根与 Session 租约规则 |
