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
├── index.ts                     统一导出（历史别名 createMindOSRuntime/MindOSRuntime 已于 2026-09-11 移除）
├── runtime/
│   ├── infrastructure.ts        VFS + LLM 设备驱动（/run 挂载、设备注册与冻结、固定用户布局预热）
│   ├── create-kernel-runtime.ts 平台无关 Kernel 组合：Kernel + kernel-adapters + Durable programs
│   ├── session-recovery.ts      Session 租约获取/恢复循环与心跳（可单测服务）
│   ├── conversation-system.ts   会话系统装配（工具过滤、Session 上下文、生命周期）
│   ├── workspace-scope-cleanup.ts 工作区清理前等待后台成员并关闭 Run 能力作用域
│   └── create-application-runtime.ts 应用运行时装配：VFS → LLM → 会话/Flow → 租约与恢复 → RunCatalog
├── session/                     Session 语义与数据交换（可依赖 vfs/）
│   ├── session-browser.ts       浏览器侧导航模型（folder:/tasks 目标解析与投影）
│   ├── session-bundle.ts        会话导出/导入格式（带版本与校验）
│   ├── session-lifecycle.ts     Session 删除顺序与有界等待（含 closeSession 调用本身的上界）
│   ├── session-route.ts         路由解析
│   └── workspace-paths.ts       /home/admin/<name> 工作区路径
├── vfs/                         Session 文件与挂载域服务（VFS 视图/后端）
│   ├── session-files.ts         Session 命名空间（revision CAS + per-session 串行队列）
│   ├── directory-mounts.ts      宿主目录挂载（DirectorySourceProvider 端口）
│   ├── session-attachments.ts   Session 附件挂载
│   ├── session-process-context.ts Session 进程上下文（native shell/tty 注入点）
│   ├── workspace-process-context.ts 同一授权 revision 的隔离文件视图与原生进程挂载获取/清理
│   ├── errors.ts                结构化错误（宿主本地化；本包不写用户文案）
│   ├── tool-context.ts          工具可见 VFS 上下文（readFile/writeFile/listFiles/stat）
│   └── unavailable-directory.ts 挂载源缺失时的占位目录
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

`createApplicationRuntime` 的顺序是：`createInfrastructure`（VFS + LLM 驱动）→ 核心服务（agent/flow/session files/mounts）→ `createKernelRuntime` → 逐个 Session 取租约并 `recoverSession` → 会话系统（`initializeConversationSystem`）→ 默认 Flow 播种 → `RunCatalog`。释放走 `cleanupFns` 逆序 + `AggregateError`，VFS 最后释放。

## 约束

- Session 与 Kernel 的所有写入都必须先持有 Session 租约（`SessionLeaseStore`）；拒租只让该 Session 保持只读，不影响其他 Session。该「只读」由 `createApplicationRuntime` 注入的写入门强制（`ensureWritable` → `recovery.acquireLater` → `initializeConversationSystem.canWriteSession` → `SessionManager.sendMessage`），被拒的 Session 会在追加 round 前报 `Session is owned by another host`。
- `ApplicationKernelPlatform.configure(kernel, services)` 在 Session 恢复扫描前等待完成；`services` 提供已初始化的 `sessionFiles`/`directoryMounts`，宿主可据此绑定工作区工厂。
- 修改挂载前必须确认该 Session 没有未结束的 Task（`mountGuard`）。
- `SessionFilesService.acquireWorkspaceFiles` 为宿主提供独立工作区视图：替换唯一匹配的现有挂载，来源由宿主提供；默认 rw 要求原授权可写，可选 ro 将全部用户挂载同时降权而不改持久授权。原授权配置改变、禁用或服务销毁时撤销全部派生工作区视图。运行时已透传 `scopeForEffect`/`fileContextForScope` 到 kernel-adapters；提供作用域文件工厂时默认按 llm-flow 持久成员及工作区租约选择 Run。Tauri 已连接独立副本文件视图、进程映射及释放，并在成功取得 Session 写租约后的 beforeSessionRecovery 回调核对创建意图。
- 用户可见文案不写在本包：结构化错误（宿主可分支/本地化，见 `src/vfs/errors.ts`）或 `t()` 键（文案在 `@itookit/common`）。`tests/no-user-copy.test.ts` 守卫本包源码不含 CJK 文案。
- 长耗时启动步骤应经 `traceBoot`/`logStep` 暴露进度，便于宿主显示启动状态。

## 运行

```bash
pnpm --filter @itookit/app-core test        # vitest：目前 15 文件 / 64 用例
pnpm --filter @itookit/app-core typecheck
```

> 本包模块的测试已在 `tests/`（2026-09-11 从 app-shell 迁回，app-shell 的兼容 re-export shim 全部删除）；app-shell 只保留其 UI 层测试。

## 相关文档

| 文档 | 内容 |
|---|---|
| [运行时架构](../../doc/runtime-architecture.md) | 装配顺序、端口注入、headless Kernel 组合 |
| [接口契约](../../doc/interface-contracts.md) | 跨包接口与实现/消费关系 |
| [VFS Session 挂载访问边界](../../doc/design/vfs-session-mount-access.md) | 命名空间、挂载与授权语义 |
| [Session 浏览](../../doc/design/vfs-session-browser.md) | `session-browser` 的路由与投影契约 |
| [MindOS profile](../../doc/mindos-profile.md) | 数据根与 Session 租约规则 |
