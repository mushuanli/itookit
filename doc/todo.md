# 目标、进度与后续任务

更新：2026-09-09（P1-08、P1-09、P2-05 已完成）。本文是本轮工作的接续入口；以当前代码和可复现测试为准。**整体目标未完成，完整桌面最小系统尚未验收通过。** 下文“已完成”只指列明的实现与验证范围。

## 1. 目标与优先级

原始目标：**扫描 `doc/design` 下的设计文档，保证与代码同步，并完成仍有效的未完成任务。** 历史上明确被取代的方案不重新实施；不能把尚未实现的要求改成“范围外”来宣布完成。

架构方向：Tauri 与 CLI 尽量共用执行核心，CLI 作为无界面入口；核心行为优先通过 CLI 验收，Tauri 额外验证平台/IPC/界面，不各自维护一套 harness。

用户后续明确的第一优先级是最小可运行系统：

1. Durable Kernel：持久 Task/Effect、结果重开、取消和恢复。
2. Skill：加载、持久身份、指令进入 harness/Agent 上下文。
3. DAG：至少一个简单的多节点图及节点间传值。
4. **Tauri 提供 Bash tool**，最终 harness 经标准 `tool.call` 调用 Bash/Bash 命令，启动子 harness，子 harness 执行简单 DAG，并回传输出和退出状态。
5. Web 暂保留平台接口，不启用本机 Bash。

跨 Session memory、完整 Skill 自动委派等扩展后移，原目标和其他有效待办继续保留。

验收链：`Tauri 外层 harness → Kernel tool.call Effect → Bash tool → 原生 Bash → CLI 子 harness → 简单 DAG → 输出/退出状态/持久记录`。

## 2. 已完成的实现与验证

| 编号 | 已完成部分 | 证据与边界 |
| --- | --- | --- |
| D01 | Kernel 的祖先取消提交屏障、后代取消恢复、终态回执重放 | 已覆盖 Task/Effect、人工裁决、资源能力、消息入口；有 LocalFS 跨进程 SIGKILL 测试。不是完整协议故障矩阵 |
| D02 | Effect 清理等待超时与 pending 保留 | 默认 30 秒；挂起/失败不伪造清理成功；单 Kernel 合并尚未结束的清理。真实外部设备停止仍需验证 |
| D03 | Session 文件上下文与显式授权挂载 | 用户文件为 attachments 与明确授予的挂载；来源注册不自动授权；见当前挂载设计。UI、工具与目录映射已有接线及测试 |
| D04 | Skill 面板加载、持久加载身份、卸载与运行上下文 | Skill 指令进入 Agent Task/Effect 输入；关闭 LocalFS 后重开恢复身份和指令；加载/卸载操作队列、动态身份与项目规则已有实现 |
| D05 | Skill → Agent → transform 最小 DAG | LocalFS 组合测试贯通面板事件、Skill 服务、Kernel 和依赖传值；模型是测试响应，未覆盖真实桌面窗口 |
| D06 | 人工回应后的同进程 DAG 延续 | 修复根任务提前完成、下游未提交；单次和连续两次人工回应沿用同一 Run |
| D07 | 人工交互检查点与 CLI 跨进程恢复 | 保存实例、完成集合、边/循环/委派状态和配置等；独立 `run`、`respond`、`resume` 进程通过，含连续两次暂停；不是任意崩溃点恢复 |
| D08 | 恢复入口及时返回及退出等待 | `resume` 装配后返回句柄，模型等待中可取消；`waitIdle()` 等待后台调度，CLI 在关闭存储/释放锁前等待退出 |
| D09 | CLI 同一 Run 调度互斥与删除保护 | 独立 SQLite 锁覆盖 run/resume/delete；争用拒绝，正常退出/SIGKILL 后可重新获取；终态但仍清理时拒绝删除。仅覆盖本机 CLI 入口 |
| D10 | Run 重连成员、Task transcript、单任务重试等 | 成员持久登记、面板/导出和单任务重试已有实现；Task 列表/历史/事件已物理分页（`listTaskPage`/`taskHistoryPage`/`taskEventPage`），transcript 版本化读取走物理分页；完整图级 retry、transcript 字节预算与真实平台文件导出验收仍待完成 |
| D11 | 人工暂停 Run 的最终统计持久化 | 最终 metadata 保存 token/耗时；重建 Kernel 后重连一致；旧记录没有自动回填 |
| D12 | Tauri Session Bash 工厂及 Web 接口 | `createSessionProcesses` 注入 Session nativeShell；Tauri 使用独立 `session_shell_exec` 和目录句柄映射；Web 无工厂时无本机 shell |
| D13 | 真实 Bash 执行、进程组取消/超时 | 保留 stdout/stderr/exit code，支持嵌套 Bash；Linux Bubblewrap 映射只读仓库与可写工作目录；无隔离能力时拒绝，不回退宿主 shell |
| D14 | Bash 清理失败处理与输出上限 | 取消失败仍尝试后续清理，重复 release 共享 Promise，保留初始化/清理错误；原生每个流保留最多 1 MiB 原始字节并继续排空管道 |
| D15 | 外层 Kernel → Bash → 真实子 CLI → 两节点 DAG | 集成测试验证依赖传值、子 Run/result 落盘、外层 Task/Effect succeeded，外层存储重开记录一致。桥接调用真实 Rust 模块，但未经过真实 Tauri IPC |
| D16 | Tauri 编译与无显示服务器 CLI 验收 | GDK 已安装，Rust check/build 和前端构建已通过；没有 X11 不影响编译，Xvfb 下窗口与基础页面已验证；完整交互未验收 |
| D17 | Session 本地 memory provider | 持久保存、按授权 scope 检索与宿主写入；由 `packages/app-core/src/runtime/create-application-runtime.ts` 装配时默认注入。不是跨 Session memory、向量检索或模型写入工具 |
| D18 | 设计与代码阶段性核对 | 已完成全量核对（见 P2-05）：`doc/design` 13 篇 + 全部 API 文档 + `AGENTS.md`/README 逐条对代码修订，`pnpm docs:check` 通过；4 份设计已移入 `doc/deprecated/`。最小系统实机验收仍属 P0 |

## 3. 需要完成的任务

以下是工作包，不是剩余代码修改条数；尚未达到可准确统计全部细项的状态。

### P0：优先完成最小系统验收

- [ ] **P0-00 两端核心装配一致性**：已抽出 `@itookit/app-core`（Session 文件/目录服务、`createKernelRuntime`、下沉到 llm-flow 的 Durable program 注册、Skill catalog 同步）并由 app-shell 与 CLI 共用；Skill 文件发现已提至共享层并接入 CLI；继续统一新运行的项目/Skill 上下文、加载身份恢复，保持平台权限适配独立。

- [ ] **P0-01 完整 Tauri 调用链**：已通过 Xvfb 启动/渲染、真实 Session Bash IPC，以及一次性模块触发的 IPC→子 CLI→两节点 DAG（仅一个 Run、两次模型请求、结果落盘）；仍需从真实应用装配/窗口发起外层 harness 的 Bash tool 调用，通过真实 IPC 启动子 CLI DAG，核对界面、Task/Effect、输出及结果重开。现有组合测试不能替代此项。
- [ ] **P0-02 应用级失败与取消闭环**：已补真实子 DAG 模型拒绝场景，验证子 Run failed、无成功结果文件、外层持久工具结果保留 `[exit 1]`；仍需验证超时、取消、Session 关闭/授权撤销、IPC 错误时的应用 UI 和持久状态一致；不能把取消请求发出等同于进程已停止。
- [ ] **P0-03 可复用运行入口与交付说明**：已新增 [运行说明](minimal-system.md) 与公开两节点 YAML，validate/graph 及真实子 harness 测试通过；仍需完成真实 Tauri 操作教程与子进程凭证注入交付，覆盖授权目录、模型配置和预期结果。
- [ ] **P0-04 平台实机验证**：Linux Bubblewrap/目录边界和实际应用端到端验证；确认其他目标平台的支持范围。无 X11 时先推进 CLI/原生模块，GUI 项保持未验收。
- [ ] **P0-05 最小系统最终回归**：在最终工作树重跑必要测试与构建，形成一份与实际版本对应的验收记录；阶段性通过不自动等于当前全部通过。

### P1：Durable、Flow 与恢复正确性

- [ ] **P1-01 任意崩溃点的持久调度**：解决 Task 提交与检查点非原子、重复提交窗口；涵盖首轮、route、loop、graph patch、动态委派、预算、完成/失败与恢复。增加明确 crashpoint 和 SIGKILL 测试。
- [ ] **P1-02 通用调度所有权与 fencing**：CLI 本机 SQLite 锁已完成；通用 Flow executor、多个恢复者、跨宿主共享存储仍需协议与验证，不能在旧拥有者仍有效时强制接管。
- [ ] **P1-03 工作区/后台委派恢复**：恢复隔离工作区租约、最终化和崩溃清理；恢复 detached 委派计时器。当前 isolated workspace resume 明确拒绝。
- [ ] **P1-04 图级 retry 与运行控制**：在已有单 Task retry 基础上实现下游重算、成员/预算/工作区/结果收敛，核对统一任务工具目标与 UI 控制语义。
- [ ] **P1-05 Durable 五篇文档的完整映射**：逐条建立目标 → API → 持久记录 → 故障测试证据；完成仍有效的遗漏和真实外部 Effect 清理验收。
- [ ] **P1-06 Transcript 存储分页与导出**：物理读取分页已落地（`packages/durable-kernel/src/infrastructure/seqfile/store.ts` 的 Task 列表/历史/事件分页 + `packages/llm-flow/src/flow/transcript.ts` 的版本化读取）；仍需完成字节预算及真实平台文件导出验收。
- [ ] **P1-07 Schema/输出策略**：responseFormat 绑定与端口错误策略已实现（`packages/llm-flow/src/flow/builtin-plugins.ts`、`packages/llm-flow/src/flow/port-contract.ts`，校验期与运行期都校验）；结构兼容推导仍未实现（端口只做 `id@version` 精确匹配、无隐式转换），动态节点验证及相应受支持子集仍需闭合，不能把当前受支持子集称为完整实现。
- [x] **P1-08 kernel-adapters 两处 Effect 回滚缺陷**：已修复。`skill.load` 与 `tool.call(load_skill)` 在身份持久化失败时按“调用前是否已加载”回滚（`skill/loaded-state.ts` 的 `rollbackFailedLoad`，已加载的不卸载；回滚自身失败时以 AggregateError 保留原始错误）；`create-kernel-adapters-runtime.ts` 的创建失败清理改为逐项执行并聚合错误（`runCleanup`/`cleanupAfterFailure`），`release` 失败不再跳过 driver dispose，原始初始化错误也不再被覆盖。回归测试见 `runtime/create-kernel-adapters-runtime.test.ts`（新加载回滚、已加载保留、清理继续且保留原始 cause）。复现记录见 [kernel-adapters 核验](deprecated/kernel-adapters-package-review.md)。

- [x] **P1-09 CLI supervisor 循环集成测试失败**：已修复。根因是回边绑定按 `doneAt(from, iteration - 1)` 取“上一轮”，只对每轮重跑全部节点的普通 Loop 成立；supervisor 每轮只派发一个 worker，第三次迭代时两个 worker 各自只有 1 个实例，回边被全部过滤，lead 拿不到累积结果。改为绑定每个回边来源的**最新已完成实例**（`latestDone(from)` + 实例序号），普通 Loop 语义不变（最新实例即上一轮），supervisor 累积全部 worker 结果。`pnpm --filter @itookit/cli test` 现 71 通过 / 0 失败；llm-flow 132、llm-session 85、app-shell 154、app-core 8 无回归。

### P2：保留但后移的扩展与全量设计闭合

- [ ] **P2-01 Skill 完整生命周期**：运行中更新、L4 编辑器 open/close 接线、初始化工具激活、严格版本冻结、自动委派与作用域销毁/重建竞态。
- [ ] **P2-02 跨 Session memory**：共享命名空间、显式读写授权、并发一致性与可审计来源；确保不同 Session 不因同名 namespace 自动互读。
- [ ] **P2-03 Memory 模型写入与管理**：模型工具、编辑 UI、长期保留/压缩策略；语义/向量检索按有效设计实施，不能用当前词项匹配替代。
- [ ] **P2-04 VFS/C4 完整验收**：按当前挂载与访问边界设计完成浏览、编辑、工具、附件、撤销和平台故障场景；旧方案已被取代的步骤不重做。
- [x] **P2-05 最终文档同步审计**：已完成。全部 13 篇 `doc/design` + 根/包 API 文档 + `AGENTS.md`/README 逐条对代码核对并修订；已被取代的设计与一次性评审记录移入 `doc/deprecated/` 并加横幅；新增 `scripts/check-docs.mjs` + `pnpm docs:check` 守卫（覆盖 67 份活文档的已删除符号、悬空路径与断链）。最小系统的实机验收仍属 P0。

## 4. Memory 的“Session 间共享”含义

跨 Session 共享指 Session B 在**明确授权**后读取 Session A 或项目共享区保存的记忆；通常需要独立于单个 Session 生命周期的存储、来源身份、读写策略及冲突处理。

目前的 `SessionMemoryProvider` 把条目保存在当前 Session 的 shared state，按 namespace/scope 管理并用 CAS 写入。这里的 shared 是**Session 内的共享状态**，不表示所有 Session 自动共享；同一 namespaceId 也不会隐式跨 Session 访问。当前是词项匹配/更新时间排序，尚无模型写入工具与长期语义记忆系统。用户已要求这部分后移，先完成最小系统。

## 5. 接续工作需要的上下文

- 工作目录：`/home/li/share/prj/x1`；主要技术栈 TypeScript/pnpm、Rust/Tauri、LocalFS/SQLite。
- 工作树包含大量既有未提交修改和新增文件；不要重置、覆盖或擅自提交。开始工作先检查当前文件，历史对话和日志只作为定位线索。
- 遵守根与相关包的 `AGENTS.md`；中文交流，新注释使用英文。没有用户明确要求时不启动子代理。
- GDK 缺失问题已解除，先前 `gdk-3.0` 检测为 3.24.52；曾通过完整 Rust 开发编译和前端构建，不等于发布安装包或 GUI 通过。
- 当前没有物理 X11 桌面，但已发现 Xvfb 并完成真实 Tauri 窗口启动/基础页面渲染检查；可继续用虚拟显示推进 GUI 验收。测试模型主要为本地固定 HTTP/SSE 响应，不代表外部模型服务已验收。
- 沙箱可能禁止本地监听或真实子进程；出现权限失败应通过正常 escalation 重跑，不能把受限环境失败当成产品缺陷，也不能把未执行视为通过。
- `waitIdle` 只等待调度协程，不强制中断任意宿主回调；停止顺序是 Kernel → executor/Kernel 工作结束 → 工具/存储 → 调度锁。
- Bash 的 Linux 隔离保留共享网络、只读运行库/DNS/证书等；不是“只看得到授权目录”的绝对文件系统或网络沙箱。stdout/stderr 上限不限制子进程本身的内存、磁盘和输出速率。
- 人工交互检查点恢复已验证正常暂停退出；不能扩展称为任意 crash resume。旧缺失最终 metadata 的 Run 未回填统计。
- `/tmp` 日志可能消失，测试源文件与重新执行的结果才是长期证据。下列计数来自不同阶段，不应相加或称为一次最终全量通过。

## 6. 代码与验证入口

| 主题 | 文件 |
| --- | --- |
| Flow 调度、恢复、等待退出 | [executor.ts](../packages/llm-flow/src/flow/executor.ts)、[scheduler-checkpoint.ts](../packages/llm-flow/src/flow/scheduler-checkpoint.ts)、[restore-handle.ts](../packages/llm-flow/src/flow/restore-handle.ts) |
| CLI 生命周期与调度锁 | [commands.ts](../apps/cli/src/commands.ts)、[runtime.ts](../apps/cli/src/runtime.ts)、[run-scheduler-lock.ts](../apps/cli/src/run-scheduler-lock.ts) |
| Tauri Bash 桥接与原生实现 | [session-bash.ts](../apps/tauri-app/src/shell/session-bash.ts)、[session_bash.rs](../apps/tauri-app/src-tauri/src/session_bash.rs)、[bash_process.rs](../apps/tauri-app/src-tauri/src/bash_process.rs) |
| Session 平台装配 | [session-process-context.ts](../packages/app-shell/src/files/session-process-context.ts)、[bootstrap.ts](../packages/app-shell/src/bootstrap.ts) |
| Session 本地 Memory | [session-memory-provider.ts](../packages/llm-session/src/session/session-memory-provider.ts) |
| 外层 Kernel/Bash/子 DAG 集成 | [nested-harness.test.ts](../apps/cli/tests/nested-harness.test.ts)、[native-session-bash.rs](../apps/cli/tests/native-session-bash.rs) |
| 人工交互跨进程恢复 | [hitl.test.ts](../apps/cli/tests/hitl.test.ts) |
| 进程互斥/删除保护 | [run-scheduler-lock.test.ts](../apps/cli/tests/run-scheduler-lock.test.ts) |
| Skill/DAG 与 Bash 桥接 | [minimal-skill-dag.test.ts](../packages/app-shell/tests/minimal-skill-dag.test.ts)、[tauri-bash.test.ts](../packages/app-shell/tests/tauri-bash.test.ts) |

从仓库根目录执行：

```bash
pnpm --filter @itookit/cli test
pnpm --filter @itookit/cli typecheck
pnpm --filter @itookit/llm-flow test
pnpm --filter @itookit/app-shell exec vitest run tests/minimal-skill-dag.test.ts tests/tauri-bash.test.ts
pnpm --filter tauri-app typecheck
pnpm --filter tauri-app build
cargo check --offline --manifest-path apps/tauri-app/src-tauri/Cargo.toml
cargo build --offline --manifest-path apps/tauri-app/src-tauri/Cargo.toml
rustc --edition=2021 --test apps/tauri-app/src-tauri/src/bash_process.rs -o /tmp/bash-bounded-tests
/tmp/bash-bounded-tests
```

最近的分项验证：

| 范围 | 结果 | 日志 |
| --- | --- | --- |
| CLI 全套，调度退出等待加入后 | 55 通过；后续删除保护另跑 11 项相关测试 | `/tmp/scheduler-drain-cli.log`、`/tmp/scheduler-delete-tests.log` |
| Flow 全套，最终统计修复后 | 126 通过 | `/tmp/restored-usage-flow.log` |
| Tauri Bash IPC 替身测试 | 8 通过，类型检查通过 | `/tmp/tauri-cleanup-focused.log`、`/tmp/tauri-cleanup-types.log` |
| Rust Bash 原生测试 | 6 通过，含大输出、取消、超时 | `/tmp/bash-bounded-tests.log` |
| Bash → 子 CLI DAG，输出上限修改后 | 1 通过 | `/tmp/bash-bounded-nested.log` |
| Tauri Rust 检查，输出上限修改后 | 通过，仍有编译警告 | `/tmp/bash-bounded-cargo.log` |
| Kernel / LocalFS IPC 历史分项 | 175 / 28 通过；不是当前整树全量重验 | `/tmp/design-cleanup-timeout-tests.log`、`/tmp/design-cleanup-timeout-ipc.log` |

## 7. 设计文档索引与完成判定

当前主线：[实施审计](deprecated/implementation-audit.md)、[Flow 执行模型](design/flow-execution-model.md)、[Skill 设计](design/skill-design.md)、[Session 挂载访问边界](design/vfs-session-mount-access.md)。

Durable 五篇：[Core](design/durable-harness-core.md)、[Protocol](design/durable-harness-protocol.md)、[Storage](design/durable-harness-storage.md)、[Resources](design/durable-harness-resources.md)、[Cache](design/durable-harness-cache.md)。

其他 VFS 文档：[总设计](design/VFS-design.md)、[消费方迁移](deprecated/vfs-consumer-migration.md)、[实现状态](design/vfs-implementation-status.md)、[C4 核验](design/vfs-c4-review.md)、[Session 浏览](design/vfs-session-browser.md)、[Session FS](deprecated/vfs-session-fs.md)、[命名空间重构](deprecated/vfs-namespace-refactor.md)。历史方案与现行要求冲突时，先按明确的替代决策核对。

标签存储：[标签存储与查询](design/label-storage.md)。

完成判定：每项有效要求都必须有当前代码/实际运行/测试证据；明确区分实现完成、模拟测试、跨进程验证、真实 GUI/IPC。最小系统优先级不缩小原始目标，不能因某个测试组全绿就标记整体完成。
