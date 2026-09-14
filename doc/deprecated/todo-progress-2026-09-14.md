# TODO 逐轮进度归档（2026-09-14）

> 清理前完整快照，保留当时表述及全部未完成要求。旧的“尚未合入”、测试数量和性能值不是当前结论；当前状态以 [TODO](../todo.md) 为准。

# 目标、进度与后续任务

更新：2026-09-14。**整体目标未完成，完整桌面最小系统尚未验收通过。** 本文只维护当前状态、剩余要求和证据入口；逐轮经过见[历史进度归档](deprecated/todo-progress-2026-09-13.md)，实机步骤见[最小系统验收记录](minimal-system-acceptance.md)。

## 1. 目标与完成标准

原始目标：扫描 `doc/design`，保证设计与代码同步，并完成仍有效的未完成任务。明确被取代的方案不重新实施；最小系统优先不代表其他要求被移出范围。

Tauri 与 CLI 共用执行核心。第一优先级是 Durable Kernel 的持久 Task/Effect、取消与恢复，Skill 加载及指令注入，多节点 DAG 传值，以及以下真实调用链：

`Tauri 外层 harness → Kernel tool.call → Bash → 原生进程 → CLI 子 harness → DAG → 输出、退出状态和持久记录`

Web 保留平台接口，不启用本机 Bash。跨 Session Memory、完整 Skill 自动委派等扩展后移但保留。

完成必须逐项核对有效设计、代码、持久记录及实际运行证据。包级测试、DOM 测试、跨进程 SIGKILL、真实 GUI/IPC、跨主机验证是不同层次；某组测试通过不证明整个工作包完成。`docs:check` 检查路径和预设符号，不验证设计语义、链接锚点或测试覆盖。

## 2. 当前已实现能力

以下仅总结已有实现，不替代第 3 节的剩余验收。

| 编号 | 当前实现 | 主要边界 / 证据入口 |
| --- | --- | --- |
| D01 | 祖先取消屏障、后代恢复、终态回执重放 | Kernel/LocalFS 跨进程测试；完整故障矩阵仍属 P1-05 |
| D02 | Effect 清理超时、pending 保留、取消等待真实完成 | 超时不伪造成功；在途操作未完成时不能宣称已停止 |
| D03 | Session 附件与显式目录授权，文件/工具/进程视图一致 | 来源注册不自动授权；[挂载设计](design/vfs-session-mount-access.md) |
| D04 | Skill 加载/卸载、持久身份、上下文注入、操作队列 | 严格版本冻结与系统性竞态核验仍属 P2-01 |
| D05 | Skill → Agent → transform 多节点 DAG | 组合测试通过；不替代完整真实桌面操作 |
| D06 | 人工回应后同进程 DAG 延续，连续多次暂停 | 沿用同一 Run |
| D07 | 人工检查点与 CLI 独立 run/respond/resume 进程 | 任意崩溃点恢复仍属 P1-01 |
| D08 | 及时发布 live Run 句柄，退出前等待调度结束 | `waitIdle()` 不强制中断任意宿主回调 |
| D09 | 本机 CLI SQLite 互斥及删除前通用调度租约检查 | 共享存储/跨主机排他仍属 P1-02 |
| D10 | Run 成员重连、单任务及图级重试、物理分页 | 见 P1-04、P1-06；不再列为未实现 |
| D11 | 人工暂停 Run 的最终 token/耗时统计持久化 | 旧缺失 metadata 的记录未自动回填 |
| D12 | Tauri Session Bash 工厂、目录句柄与 Web 接口 | Web 无原生工厂；Tauri 不回退到未隔离 shell |
| D13 | Bash 输出/退出码、进程组取消与超时 | Linux bwrap 已有真实进程证据；共享宿主网络 |
| D14 | Bash 清理错误聚合、幂等 release、每流 1 MiB 输出上限 | 仍排空管道；不限制子进程磁盘、内存和输出速率 |
| D15 | 外层 Kernel/Bash → 子 CLI DAG 及重开记录 | 真实窗口链路见 P0-01 |
| D16 | Tauri 构建、Xvfb/AT-SPI 窗口与目录操作 | 不等于其他平台、发布安装包或全部 GUI 验收 |
| D17 | Session 本地 Memory、管理 UI、模型工具及 CLI 配置 | 已有持久化和 HTTP mock 调用；跨 Session、语义检索仍未完成 |
| D18 | 设计/API/包说明阶段性审计与历史方案归档 | 全量有效要求闭合仍属 P1-05、P2-05 |

## 3. 任务清单

### P0：最小系统验收

- [x] **P0-00 两端核心装配一致性**
  - 已实现：app-core 共用装配、项目规则与 Skill 解析；CLI 模型请求、Tauri 宿主装配及真实窗口首次加载已有证据。
  - 已收口（2026-09-13）：`SKILL.md` 新增 `auto-load` 覆盖，使文件系统来源能表达「可加载但不自动注入」；项目规则锚定项目根，parent-fs/local-fs 的嵌套 `_agent/AGENT.md` 不合并/不替换，Skill 仍按层级级联。CLI 与真实 Tauri 入口均核对：命中加载并持久身份、重开后按身份恢复、卸载后不复活、再次命中可重新加载；包级（真实 runtime+Kernel+文件来源）、桌面宿主装配（`createApplicationRuntime`+`TauriSkillSource`）、CLI 真实请求与真实窗口四段闭环（Xvfb/dbus/AT-SPI）逐层取证。
  - 见[验收 §71](minimal-system-acceptance.md)、`session-file-source.test.ts`、`session-skill-restore.test.ts`、`tauri-host-skill-context.test.ts` 与 `run-skill-context.test.ts`。
  - 边界：真实窗口的卸载是把持久身份记录置为 `[]`（与面板/skill.unload 写入同一记录），面板复选框的 GUI 勾选未驱动成功（条目渲染在可达视口之下）；该交互与多层级嵌套挂载的真实窗口场景归 P0-04。

- [x] **P0-01 完整 Tauri 调用链**
  - 真实窗口 → 外层 harness → Bash/IPC/bwrap → CLI 子 DAG → 结果和退出码，重开 transcript 已通过。应用内挂载对话框建授权亦通过。
  - 见[验收 §3、§18、§20](minimal-system-acceptance.md)。模型为本地 mock；其他失败场景归 P0-02。

- [ ] **P0-02 应用级失败、取消与性能闭环**
  - 2026-09-14 恢复复核：两个真实进程下，已打开读者未发现另一进程 SIGKILL 遗留 rename intent，root/module 两条回归均复现。已移除实例内 journal 干净缓存，读取与恢复恢复为同一事务；此前依靠跳过恢复检查的性能数字需要重测。完整读取优化批次尚未合入。
  - 已验证：CLI 超时/SIGINT/进程树停止；Session 关闭等待确认；真实窗口取消及重开后的 ABORTED/原因保留；撤销挂载后工具 FAILED、重开仍保留工具与错误；只读挂载拒绝写入。文件保存失败会提示并保留 dirty。
  - 空闲目标已达成：既有真实窗口 70 秒 VFS 0、sidecar 32 次（约 0.46 次/秒）。当前树真实窗口发送 ping 到 mock 收齐请求为 **2.707 秒**，仍未达 **≤2 秒 / ≤100 次调用**；覆盖发送的两个 trace 区间共 953 次公开 API 请求，但含边界外操作，不是精确发送计数。已合并资源清理候选事务并减少目录/批量读取的重复解析；无 GUI 最近 482 次逻辑调用不能替代桌面 IPC。继续补动作边界快照和内部直调/通道覆盖，见[读取成本](design/vfs-sidecar-read-cost.md)、[验收 §70](minimal-system-acceptance.md)。
  - 剩余：真实窗口的超时、Session 运行中关闭/删除、IPC 故障、发送回滚与保存失败/重试；设备不确认停止时的有界失败及数据保留；监控/取消的 live 与重开一致性。
  - 补真实 GUI 的“请求已接受 / 状态已变化 / 外部已停止”区分，以及 pause 同类文案。活动 CLI Run 只能由拥有者取消；另一 CLI 进程拒绝越过 Session 租约。
  - 见[验收 §11–19、§23–27](minimal-system-acceptance.md)及 `run-control.test.ts`、`session-delete-lifecycle.test.ts`。

- [x] **P0-03 可复用运行入口与交付说明**
  - [运行说明](minimal-system.md)已覆盖启动、隔离数据根、Provider/Connection、目录授权、子进程凭证注入与预期结果。
  - 用户决定保持 API Key 明文落盘；设置页已注明路径和 Session Bash 不继承宿主环境，见[验收 §28](minimal-system-acceptance.md)。不重新引入密钥环方案。

- [ ] **P0-04 平台实机验证**
  - 已有 Linux bwrap/目录/符号链接边界、取消/超时、缺隔离器拒绝、Xvfb/AT-SPI 窗口与应用内目录授权证据。
  - 剩余：其他目标平台的支持范围及真实行为、原生 GTK 目录选择器、P0-00/P0-02 等尚缺窗口场景、发布产物的支持边界；其中含 Skill 面板复选框的真实 GUI 勾选/取消（当前条目渲染在可达视口之下未驱动成功）与多层级嵌套挂载下的项目规则窗口场景。
  - Tauri Session Bash **共享宿主网络**；无出网或连接超时不能当作网络沙箱证据。见[验收 §29](minimal-system-acceptance.md)。

- [ ] **P0-05 当前最终回归**
  - 旧树 `d883a497` 的阶段性矩阵已完成并保留在[验收记录](minimal-system-acceptance.md)，不能作为后续大量改动后的最终通过证据。
  - 待其余有效要求闭合后，对最终工作树执行类型、文档、样式、库/CLI/前端/原生产物构建、全量测试矩阵与真实窗口验收，记录版本、命令、结果和剩余跳过项。

### P1：Durable、Flow 与恢复正确性

- [ ] **P1-01 任意崩溃点的持久调度**
  - 已实现：先持久根/检查点再派发、稳定 requestId 与 spec 指纹去重、成员与循环/patch/委派恢复。结果不确定的 Effect 标记 indeterminate，CLI 退出码 3；显式 `resume --retry-indeterminate` 才授权重放。
  - 已有六个 CLI SIGKILL 场景及包级委派恢复；节点提交与检查点并非同一事务，但稳定 requestId 可复用原 Task，不能再笼统称为“没有去重”。
  - 剩余：按协议补全崩溃窗口，尤其委派真实进程故障、提交/检查点间隙的完整核验，确认不重复 fan-out、已完成迭代或外部副作用。CLI schema 尚不暴露 delegation。
  - 入口：`apps/cli/tests/crash-matrix.test.ts`、`packages/llm-flow/__tests__/durable-flow-executor.test.ts`。

- [ ] **P1-02 通用调度所有权与 fencing**
  - 已实现：Session/Run 租约、epoch、心跳、每步所有权检查、失权停止；CLI 本机锁与删除前通用租约核对。
  - 接管要求旧租约到期加显式 `skewMs` 预算；CLI 支持 Session/Scheduler 两种 `*_LEASE_SKEW_MS`。默认 0 不构成跨主机时钟保证。
  - 剩余：S3/NFS 类共享存储的原子性、authority store 时间/时钟假设、真实多进程/多主机竞争、迁移与旧拥有者 fencing 验收。

- [ ] **P1-03 工作区与后台委派恢复**
  - 已实现：CLI/Tauri worktree manager、持久租约、Run 文件/进程/cwd 一致、detached deadline 恢复、终态 pending 收尾；Tauri Git 前落创建意图，启动取写租约后核对遗留项。
  - 已验证：真实 LocalFS/SQLite/Kernel/Flow 三个 SIGKILL 窗口；Tauri WebView/native IPC/SQL/bwrap 自动 worktree 与只读探针。discard 可清脏副本；manual 不强删成功 Run 的脏副本；auto-if-clean 拒绝未提交修改。
  - 剩余：CLI read-only **真实 OCI** 验收、CLI worktree + OCI、合并/冲突交互、用户窗口启动工作区 Flow 和真实桌面重启、授权变化或 Kernel 未发现 Session 的遗留意图回收、P1-02 跨主机租约验证。
  - Tauri read-only 当前基于**原有可写仓库授权**创建只读 Git 副本；Web 无宿主进程通道时拒绝隔离模式。CLI 原生只读模式拒绝，OCI 单次命令/TTY 映射已接线，环境尚未找到 Podman/Docker。
  - 见[Flow 设计](design/flow-execution-model.md)及[验收 §52–60](minimal-system-acceptance.md)。自动探针不等于完整用户窗口验收，临时探针构建需恢复为正常产物。

- [ ] **P1-04 图级 retry 与运行控制**
  - 图级/委派组/隔离工作区重算、下游取消与代数更新、token 退款、DagWorkbench 入口均已有回归；直接以合成委派子节点为重试源仍拒绝。
  - 入口：`graph-retry.test.ts`、`durable-flow-executor.test.ts`、`dag-run-retry.test.ts`。剩余真实窗口重算操作及结果收敛提示验收。

- [ ] **P1-05 Durable 五篇设计完整映射**
  - 已合入 `bfe3cbf4`：跨 Session settlementAcknowledgedAt 持久确认、未确认回执不回收、终态源恢复只补确认；隔离 759 项测试通过。真实跨进程/多主机旧在途投递、混合版本及 replay 水位假设仍开放。
  - [证据映射](design/durable-harness-evidence.md)是逐条审计入口，涵盖 Protocol 十条不变量、kill 矩阵及 Core/Storage/Resources/Cache 验收表。
  - 已实现：Task/Session cache 清理、cache 策略矩阵、预算 usageId 幂等、authority epoch 骨架、消息/回执 retention、layout manifest、Task history compaction、事件裁剪水位及进程停止确认。
  - 剩余：cache provider 能力差异及跨 Session retention/GC 竞争；真实供应商重复计费核对；资源 adapter 执行令牌 fence、多进程/多 store 迁移屏障、account/allocation/export/import 记录族；Storage §5 目标字段与记录族拆分；完整 stream/消息/receipt/compaction 故障矩阵；GUI 停止三态验收。
  - 内核预算回执幂等不等于供应商未重复收费，authority 元数据不等于资源执行端已 fencing，SIGKILL 不等于断电持久性。

- [x] **P1-06 Transcript 存储分页与导出**
  - 物理分页、固定版本、maxBytes 裁剪及水位、CLI 真实文件导出、UI 独立遍历分页导出已有证据；UI 导出保留单调性和 10k Effect 上限守卫。
  - 入口：`transcript-budget.test.ts`、`task-transcript-dialog.test.ts`、CLI `run.integration.test.ts`。

- [ ] **P1-07 Schema/输出策略**
  - 已实现：受支持结构子集的同 id 跨版本兼容推导、无人消费输出验证、运行定义/动态图检查点冻结；不同 schema id 不做隐式转换。
  - 剩余：端口错误的 repair/continue 策略；明确节点级输出契约后，将 Agent responseFormat 编译成可引用端口 schema。插件清单契约与节点级配置不能直接混用。
  - 同名 `plugin@version` 的宿主实现代码未冻结；需明确其版本漂移处理。见[Flow 设计](design/flow-execution-model.md)、`port-contract.test.ts`。

- [x] **P1-08 Effect 回滚缺陷**：Skill 身份持久化失败只回滚本次新加载，清理逐项执行并聚合原始/清理错误；`create-kernel-adapters-runtime.test.ts` 有回归。
- [x] **P1-09 CLI supervisor 累积结果**：回边使用来源最新已完成实例，支持轮流派发 worker；普通 Loop 语义保持，CLI/Flow 已有回归。
- [x] **P1-10 CLI 非交互监控窗口**：持久根建好后及时发布 live 句柄，调度期失败写入 Run；Tauri 监控/取消窗口剩余验收归 P0-02。

### P2：扩展与设计闭合

- [ ] **P2-01 Skill 完整生命周期**
  - 已合入 `a8288084`：Skill 初始快照、直接会话/Flow 接线、UI/宿主入口与关闭屏障整批隔离验证；action Skill 不自动进入 system 提示。严格版本冻结、自动委派与其余竞态要求仍开放。
  - 已实现：直接会话/Flow 初始 Skill 快照及工具交集、编辑器 glob open/close、列表变更通知、手动斜杠入口。
  - 剩余：严格版本冻结的 keep-old / require-reload / drift marker 语义、自动委派到统一 TaskGroup 的编译接线、作用域销毁/重建竞态系统核验。
  - 当前通知仅进程内；跨进程直接修改文件不触发。在途 Task 的 system 消息不改，新定义在后续上下文组装时生效。见[Skill 设计](design/skill-design.md)。

- [ ] **P2-02 跨 Session Memory**
  - 已验证不同 Session/namespace/scope 隔离；跨 Session 共享协议尚未实现，需定义独立生命周期存储、显式读写授权、来源身份、并发一致性与审计。
  - Session shared state 只在当前 Session 内共享。同一 namespaceId 不自动跨 Session；CLI 新 Run 不自动读取旧 Run 记忆。

- [ ] **P2-03 Memory 模型写入与管理**
  - 已实现：SessionMemoryProvider 的 CAS 存储、scope 授权、完整列表、摘要条件编辑/删除、容量/时间水位清理；并发 prune 计数和同毫秒裁剪缺陷已修；仅 Kernel CONFLICT 重试，其他提交前/后存储错误直接返回。
  - 已实现：Files 页记忆管理 UI，固定 Session、写租约检查、冲突保留输入；直接会话与 Flow 的策略快照；memory_list/write/remove 经 tool.call 校验持久 Task 白名单及策略。CLI Agent `memory_policy` 同步进入节点和 RunDefinition。
  - 已验证：DOM + 真实 LocalFS/SQLite 重开后编辑保留、删除不复活；真实 Durable Agent 两轮调用；真实 CLI + 本地 HTTP mock 调用及退出后磁盘读取；取消等待和普通 ToolService 绕过被拒；CLI 写入/删除成功回执后 SIGKILL，恢复保持记忆版本及工具执行次数不变；另有写入/删除服务调用前及提交后未写回执的四个 SIGKILL 窗口，默认阻断、显式重放后成功。
  - 剩余：真实 Tauri 窗口操作、真实云模型调用、条件写冲突后的人工处置、独立 retention/GC 故障及存储事务内部持久性验证；语义/向量检索及压缩策略。当前词项匹配/更新时间排序不等于语义检索，容量/时间裁剪不等于内容压缩。
  - 写工具属于 local 副作用，崩溃结果不确定时不盲目重放。条件编辑比较内容摘要而非历史版本，无法识别相同内容的删除重建。见[Memory API](llm-session-api.md)、[CLI 配置](../apps/cli/README.md)及[验收 §61–63](minimal-system-acceptance.md)。

- [ ] **P2-04 VFS/C4 完整验收**
  - 附件-only、逃逸拒绝、全部只读变更动词、同名挂载跨 Session 隔离、默认目录不隐式授权、卸载保留文件与旧句柄失效已有包级证据；真实 GUI 挂载/撤销/只读与 bwrap 边界已有记录。
  - 剩余：旧句柄失效的真实窗口可观察路径及有效设计要求的浏览/编辑/工具/附件/平台故障矩阵；不重做已被取代的方案。

- [x] **P2-05 文档同步审计（已记录范围）**：已完成阶段性设计/API/AGENTS/README 核对及历史方案归档；逐条语义与故障证据仍由 P1-05 和其余未勾选项闭合。
- [x] **P2-06 app-core 包内边界与技术债**：包说明、测试归属、app-shell 兼容 shim 删除、runtime/infrastructure 拆分、公开 VFS ioStats、session/vfs 目录归类、index 别名收口、静默失败可见化、租约 init 去重及已有 app-core 文案 i18n 均已完成。
  - 分批合入验证：应用层整理提交快照通过 app-core 72 项、app-shell 112 项、CLI HTTP 2 项测试（另有 30 项既有跳过），以及 app-core、Web、Tauri、CLI 类型检查；新增基础设施初始化失败和清理失败回归。最终全仓验收仍见 P0-05。

**样式待办（仍保留）**：补齐 `scripts/style-class-allowlist.txt` 中待补样式，完成后删除对应豁免。包括 Agent 快捷 Prompt、DAG 空态/运行视图、同步设置、VFS 列表/移动弹窗/mention 预览、mdx 打印及零散元素。`styles:check` 通过只表示未新增漂移，不表示豁免项已完成。本地图标字体已接入，MathJax/Mermaid 仍使用配置的 CDN。

## 4. 下一步与验证入口

优先补 P0-00/P0-02/P0-04 的真实窗口与性能闭环，再推进 P1 的故障矩阵和共享存储所有权。P2 保持开放；Memory 不再从“缺工具/缺编辑器”重新实现，应从剩余验收、共享协议与检索能力继续。

| 主题 | 入口 |
| --- | --- |
| 最小系统与桌面操作 | [运行说明](minimal-system.md)、[验收记录](minimal-system-acceptance.md) |
| Flow 恢复与工作区 | [Flow 设计](design/flow-execution-model.md)、[Flow API](llm-flow-api.md) |
| Durable 完整要求 | [证据映射](design/durable-harness-evidence.md)、[Kernel API](kernel-api.md) |
| Memory 实现与配置 | [Session API](llm-session-api.md)、[CLI README](../apps/cli/README.md)、`apps/cli/tests/run-memory.test.ts` |
| 共享装配 | [运行时架构](runtime-architecture.md)、[包结构](pkgstructure.md) |
| Skill 与文件边界 | [Skill 设计](design/skill-design.md)、[挂载设计](design/vfs-session-mount-access.md)、[Session 浏览](design/vfs-session-browser.md) |
| 其余有效设计 | [VFS 总设计](design/VFS-design.md)、[实现状态](design/vfs-implementation-status.md)、[C4 核验](design/vfs-c4-review.md)、[sidecar 读取成本](design/vfs-sidecar-read-cost.md)、[标签存储](design/label-storage.md) |

最近分项证据（2026-09-13，来自不同执行，**不是一次当前整树最终矩阵**）：

| 范围 | 最近记录 |
| --- | --- |
| app-core 整包 | 81 项通过，含真实 Durable Agent 记忆调用 |
| kernel-adapters | Effect/运行时 42 项通过；追加取消用例后 Effect 专项 14 项通过 |
| llm-session 整包 | 111 项通过；之后的 Memory/Flow 改动另有专项验证 |
| CLI Memory | 配置 + 真实 HTTP mock 集成共 20 项通过；另有已提交写入/删除恢复 2 项、缺失回执窗口 4 项 SIGKILL 测试分次通过，类型检查通过 |
| Memory UI | 对话框/工作区 9 项通过；之后补真实磁盘重开测试，两份 Memory UI 测试通过 |
| 类型与静态检查 | 相关 CLI/Tauri/逻辑包类型检查通过；文档 76 份通过、5 条历史表述告警；样式检查通过（豁免仍存在） |

从仓库根目录执行，按改动先跑相关包；最终验收不能省略完整矩阵与实机步骤：

```bash
pnpm typecheck
pnpm docs:check
pnpm styles:check
pnpm build:libs
pnpm --filter @itookit/cli build
pnpm --filter tauri-app build
pnpm --filter tauri-app test:rust
pnpm test
cargo build --offline --features tauri/custom-protocol --manifest-path apps/tauri-app/src-tauri/Cargo.toml
```

后端/网络/GUI 操作受环境限制时通过正常权限机制重试，不能把未执行当通过。保护已有工作树修改，不擅自回滚或提交；无明确授权不启动子代理。Xvfb 已用于真实窗口验收，AT-SPI 需要可写缓存与显示会话；临时探针入口、前端和原生二进制均需恢复为正常版本。`/tmp` 日志会消失，长期证据以测试源文件与可复现验收记录为准。

## 5. 文档维护规则

- 本文保留当前任务状态，每项只写“已实现 / 剩余 / 证据”，不追加逐轮流水账。
- 详细实验步骤、数据根、截图、命令和结果放入[验收记录](minimal-system-acceptance.md)，设计决策更新对应活文档。
- 已完成行若仍含有效未完成要求，应拆开或取消总项勾选；不能通过删掉要求来闭合任务。
- 历史快照仅供定位：[清理前完整进度](deprecated/todo-progress-2026-09-13.md)。历史计数、旧工作树和已被取代结论不作为当前完成证明。

### 生命周期大批次合入前审查（2026-09-13）

本批仍待组合成提交快照，以下为当前工作树验证，不代表已合入或完成 P0-02 全部实机验收：

- 已修正适配器取消确认的身份冲突：按 Session + Task + Effect 记录全部在途执行，其他任务或会话中的同名 Effect 结束不会提前解除等待；新增跨 Task、跨 Session、同身份重叠执行回归。
- 已修正 Session 删除的超时边界：关闭调用和后续状态读取共享截止时间，迟到结果不会继续删除；状态读取卡住、释放后重试已覆盖。
- 已修正重复关闭终态 Session：关闭请求在事务内保留 closed/archived，普通状态转换仍拒绝倒退；关闭后删除重试已覆盖。
- 当前工作树验证：durable-kernel 225 项、kernel-adapters 107 项、app-core 93 项测试通过，三包类型检查通过。继续核对 Flow 运行句柄提前发布、消费者收尾和 UI 停止状态后，再统一验证并合入生命周期批次。

生命周期批次继续审查：Flow 调度异常后的任务取消失败现在会阻止能力释放及工作区清理，并把原始调度错误与取消错误共同呈现在 Run 失败状态中。会话消费者在最终任务列表发现失败时仍等待已有事件消费者收尾，避免宿主提前释放其依赖。新增两项回归；当前工作树 llm-flow 209 项、llm-session 114 项测试及两包类型检查通过。仍需完成 UI/CLI 消费端核对和实际提交快照验证后统一合入。

### 生命周期批次验证（2026-09-13）

本批合入运行句柄提前发布、取消确认、失败消费收尾、关闭与删除重试、失败记录重载，以及 CLI/UI 对应处理。隔离提交快照：durable-kernel 210、kernel-adapters 94、app-core 76、llm-flow 190、llm-session 102、app-shell 112、CLI 集成 20 项测试通过，合计 804 项；30 项既有条件跳过。五个逻辑包和 CLI/Web/Tauri 类型检查通过。Kernel 两项短时序测试曾在六包并行负载下失败，按包顺序复跑全部通过。文档检查仍受基线未构建 CLI 产物路径影响。

这批不替代 P0-02 的真实窗口完整验收、P0-05 最终全仓矩阵，也不表示宿主工作区接线、跨宿主 fencing 或记忆功能已合入。

### 工作区隔离批次合入前审查（2026-09-13）

- 已修正工作区释放等待：终态 Task 的在途 Effect／待确认清理仍阻止释放；等待期间重新读取持久成员及重试记录，覆盖新出现的成员。
- 已修正 CLI 删除租约判断：损坏或不支持的记录拒绝删除；已配置的调度时钟误差计入放行时间，显式释放的租约立即放行，非法配置在打开存储前拒绝。
- 当前工作树验证：llm-flow 210 项、app-core 工作区链 7 项、租约校验 7 项、CLI 真实终止宿主删除回归 2 项通过；llm-flow、CLI 类型检查通过。该证据不等于跨主机实测。
- 合入前仍须完成完整宿主工作区准备／恢复／释放接线的隔离提交快照验证；下述 CAS 删除标记已替代只读租约检查。P1-02 的真实跨主机与外部写入 fencing 仍未完成。

工作区批次追加修正（2026-09-14）：CLI 删除先在 scheduler-owner 同一条 shared 记录上 CAS 写入永久 `deleted` 标记，再删除 CLI Run 目录；Kernel 记录保留标记，失败重试不撤销它。调度接管与删除竞争同一版本，终态工作区清理恢复也先获取租约。双顺序竞争、时钟余量、非法记录及重复删除已覆盖（调度租约 14 项通过）；真实 CLI 删除回归 2 项通过，并在 Run 目录删除后重新打开存储确认标记仍存在。Flow 整包回归通过，llm-flow 与 CLI 类型检查通过。协议要求所有参与调度者实现删除标记检查，未证明旧宿主混跑或已在途外部写入受强 fencing 约束。仍待本批完整提交快照验证后统一合入。

工作区关闭重试审查（2026-09-14）：Run 作用域与 Session 清理保留失败步骤，成功步骤不重复执行；并发关闭共享同一次尝试，失败后仍禁止重建能力，释放成功后才允许 Session 重新获取。原生进程停止失败时保留文件上下文，重试先停止进程再释放文件，避免进程仍在运行时撤销依赖。新增 Run 与 Session 失败后重试回归，并修正进程清理测试契约。当前工作树 kernel-adapters 109 项、app-core 93 项整包测试通过；app-core 类型检查通过。上述改动仍归入待合入的工作区隔离大批次。

桌面工作区释放审查（2026-09-14）：Tauri 目录来源保留失败的 owner／目录句柄，已成功步骤不重复关闭，失败后仍拒绝新获取；owner 释放未成功时不提前关闭对应目录授权。工作区外层和原生进程层不再永久缓存失败的释放 Promise；进程授权关闭成功后才释放文件来源，重试仅关闭尚未成功的授权。新增跨层释放失败重试回归。当前工作树 35 项桌面清理／授权／工作区接线测试通过，三项真实子进程 SIGKILL（intent、created、published）恢复测试在允许 Git 子进程执行后通过，Tauri 类型检查通过。这里的宿主测试使用 IPC 适配测试环境，不替代真实桌面窗口完整验收；工作区大批次仍待隔离提交快照验证。

### 隔离工作区批次验证（2026-09-14）

本批按完整宿主链合入：CLI 工作区配置/文件与进程映射、Tauri Git 能力及创建意图恢复、共用 Run 能力选择与释放屏障、可重试资源清理、调度接管与删除 CAS 互斥。CLI 和 Tauri 都在工作区收尾前等待持久成员及后代的在途操作，再关闭 Run 能力；失败保留待重试的清理步骤。

隔离提交快照验证：llm-flow 210、kernel-adapters 99、app-core 91、llm-session 104、app-shell 142、CLI 工作区相关 44、普通 Run/HTTP 回归 16、Rust 28 项通过，合计 734 项；app-shell 30 项既有条件跳过。七个包/宿主类型检查通过。CLI 使用真实 Git、本地 HTTP 和 SIGKILL；桌面恢复使用 IPC 测试宿主及真实 Git/子进程，Rust 覆盖原生命令边界。文档检查保留基线未构建 apps/cli/dist/cli.js 路径问题。

该批不等于 P1-03 整项验收完成：真实 OCI、GUI 重启/交互及跨平台仍待验证；P1-02 的多主机失权停写和强 fencing、P0-02/P0-05 的完整桌面与最终全仓矩阵也仍未完成。删除标记只对识别该协议的参与宿主有效。

### 原生进程生命周期批次（2026-09-14）

已修复 CLI 启动前已取消仍执行命令、父进程退出且后台成员关闭管道后提前返回，以及清理定时器伪造完成的问题。CLI 与 Tauri 的一次性进程调用在返回前确认本次进程组停止；Linux 排除已不能运行的 zombie，仍能运行或无法核验的成员保持清理等待。失败不释放正在使用的工作区。

隔离快照：CLI 取消/原生 bwrap/普通 Run/shell 共 27 项、Rust 33 项、工作区恢复 5 项、嵌套 harness 成功/失败 2 项通过，合计 67 项；CLI 类型检查通过。嵌套测试首次受快照缺 tsup 命令及容器外依赖链接阻断，补齐相同版本依赖后两项通过；CLI 构建产物已实际生成，docs:check 通过，保留 10 条基线告警。两项新增 CLI 真实进程回归在修复前失败，修复后通过。Tauri 原生测试验证取消前持续写文件、取消后文件不再增长；这不替代真实 GUI 的取消操作。原生进程组不等于安全容器：主动脱离进程组的程序、其他平台和完整 OCI 生命周期仍需后续验收，P0-02/P0-04 保持开放。

### Skill 执行与宿主入口批次（2026-09-14）

本批合入初始 Task Skill 快照、直接聊天与 Flow 节点接线、显式斜杠调用、编辑器 glob 匹配、目录变更刷新，以及 CLI/Tauri 共用文件来源的加载/卸载/身份恢复回归。关闭 Session/运行时先失效排队操作，等待在途 Skill 操作和身份恢复后才释放能力；action Skill 不再自动进入系统提示，显式调用前重新检查定义是否启用。刷新使用同一队列，过期响应不覆盖新状态，销毁后不更新面板。

隔离快照：llm-tasks 37、llm-flow 212、llm-session 105、kernel-adapters 110、app-core 91、llm-ui 26、app-shell 148、真实 CLI Skill 请求 2 项通过，合计 731 项；app-shell 30 项既有条件跳过。相关类型检查和 Tauri 前端构建通过。CLI 使用本地模型服务；桌面证据为宿主装配与 DOM/IPC 测试，未替代真实窗口验收。

P2-01 的严格版本冻结（keep-old / require-reload / drift marker）、自动委派到统一 TaskGroup、剩余作用域竞态仍开放；跨进程修改文件通知、真实 GUI 操作等仍按原 TODO 验收。初始快照不代表完整版本冻结或自动委派已实现。

### Session Memory 完整功能批次（2026-09-14）

本批合入 Session 本地记忆持久化与管理、任务冻结授权、模型工具、Files 管理界面和 CLI 配置。版本冲突才重试；提交前/后返回存储错误的两项新增回归修复前失败、修复后通过，避免不确定提交被重试掩盖。

隔离提交快照：durable-kernel 210、llm-tasks 43、llm-flow 213、llm-session 116、kernel-adapters 111、app-core 92、app-shell 150、CLI 配置/Memory 集成 20、CLI 崩溃矩阵 10 项通过，合计 965 项；app-shell 30 项既有条件跳过。10 个包/宿主类型检查、CLI 构建与 help 入口、Tauri 前端构建通过。docs:check 通过（71 份活文档、9 条既有告警），styles:check 通过（107 项既有豁免）。CLI/桌面宿主子进程测试初次受沙箱 HTTP/Git 权限限制，正常申请权限后重跑通过。

6 个 Memory SIGKILL 窗口涵盖写入/删除调用前、提交后但成功回执前，以及回执后：不确定工具默认阻断，显式授权后才重放；已完成工具保持存储版本与执行次数不变。管理 UI 使用 DOM 与真实 LocalFS/SQLite 重开验证，CLI 使用本地 HTTP mock；不替代真实 Tauri 窗口或云模型验收。跨 Session 共享、语义/向量检索、内容压缩及完整存储故障矩阵仍开放，P2-02/P2-03 不勾选完成。

### Flow 工作台重算与记录导出批次（2026-09-14）

图级重算入口、独立幂等请求身份、Transcript 字节预算浏览与固定版本完整导出一起验证。修复末页越过 10,000 条上限、非法游标/身份或版本混入、截断数据误作完整导出、翻页后丢失截断提示；窗口关闭停止后续导出读取，导出与翻页互斥。

新增 6 项边界回归在补齐合法测试记录后，原逻辑全部失败、修复后通过。真实 Kernel 重开经 DagCommandService 与 DOM 导出 101 个 Effect，固定版本与 300 KB 原始响应保留。隔离快照 llm-flow 213、llm-ui 26、app-shell 160 项通过，共 399 项，另有 30 项既有条件跳过；Web/Tauri 类型检查和 Tauri 前端构建通过。DOM/浏览器下载接口验证不替代真实桌面保存路径或图重算结果收敛操作，相关实机 TODO 保持开放。

### 发送失败、审批恢复与终态展示批次（2026-09-14）

发送返回错误时恢复草稿并显示错误，不再按发送前后轮次差集推测并删除记录：回复丢失不能证明请求未被受理，已有历史与执行事实需保留。发送不依赖额外历史查询；附件上传失败不发起 Send。发送期间切换会话的完整草稿/请求归属仍需另行验收。

编辑器重开时优先恢复仍未终态的已记录特权 Task，否则查找当前 Session 最新的待交互 Task。查找返回后核验编辑器身份、Session 与挂接操作代数，关闭或新挂接使旧结果失效；销毁开始就解除挂接。挂接在首次异步让出前捕获代数，detach 后不会复活。事件重放仅向审批界面转发持久记录仍为 pending 的请求；已有历史审批不会再次弹出。

TTY 首次结束信息保持不变，后续结束通知与输出不覆盖；已知退出码与未知退出码分别显示，新增文案同步中英文。failed/aborted 历史节点均显示经过转义的原因。

隔离快照验证：llm-ui 28 项，app-shell 整包 178 项及新增终态原因 2 项，共 208 项通过；30 项既有条件跳过。Web/Tauri 类型检查及 Tauri 前端构建通过。发送回归原逻辑 3 失败/1 通过、修复后 4 通过；关闭挂接回归修复前失败、修复后通过。真实 Kernel 重建后，待审批 Task 重新挂接并批准，原 Task 成功且没有新建替代任务。该测试使用内存 VFS 的持久记录重建，不等同于进程 SIGKILL 或真实 GUI；P0-02/P0-04/P0-05 仍开放。

### 缓存与消息保留/清理批次（2026-09-14）

已组合缓存终态物理清理、旧 owner 索引重建及身份校验，和跨 Session 消息结算确认/GC。修复旧缓存漏清理、错误 owner 索引删除他人缓存，以及目标已消费而源端未结算时回执被提前回收的问题；相关缺陷均先复现再修复。恢复只补终态源的确认，不重新投递；未确认的跨 Session 记录受保护，非法水位/limit 拒绝且不改记录。

隔离提交快照：durable-kernel 227、llm-flow 213、llm-session 116、kernel-adapters 111、app-core 92 项通过，共 759 项；Kernel/CLI 类型检查通过。retention.test.ts 覆盖 17 项（含三个 Kernel 重建窗口），不依赖尚未合入的资源 authority、轮询性能或其他协议测试改动。文档检查通过。

P1-05 保持开放：本批不替代真实进程/多主机或旧版本混用测试；重放水位、旧在途消息与强 fencing、独立 provider/跨 Session 缓存、完整 GC 故障矩阵仍待完成。


## 2026-09-14：托管资源 authority 事务隔离

资源创建时携带 authority 会把 `authorityId` 持久绑定到资源；share/revoke/destroy/open/acquire/release/close/write 必须提交同一 authority 的当前 ownerEpoch，省略、替换身份或旧 epoch 均拒绝。接管以 expectedEpoch CAS 递增，Session 不能接管其他作用域，安全整数溢出拒绝且事务回滚。已完成请求重放原回执；尚未分配的排队申请在接管后失败，已有 claim 保留至明确释放。读取沿用既有授权规则。

首次 claim 将该资源存储升级到 managed/schema=3，后续普通写入不降级；只支持 schema 1/2 的旧 managed-resource 实现拒绝访问。既有未绑定资源保持原行为，不猜测或自动迁移 authority。binding 仅是当前存储内不可变标记，不证明其他独立存储不能建立同名 authority。

本批只完成同一事务存储内的资源命令隔离。物理 adapter 的执行端 token、接管前已开始的外部操作、跨 store 迁移屏障与真实多主机故障矩阵仍待完成，P1-05 保持开放。

隔离提交快照验证：durable-kernel 239、llm-flow 213、llm-session 116、kernel-adapters 111、app-core 92 项通过，共 771 项；Kernel/CLI 类型检查与文档检查通过。资源回归含同存储两个 Kernel 并发 CAS、重建、身份省略/替换、排队接管、schema 升级与 Decision 回滚；不作为真实多进程或物理执行端验收。

本轮验证：LocalFS 配置内全套 66 项通过（含真实进程 SIGKILL、root/module 与预先打开读者），类型检查通过。修复后同口径 Node 发送探针：62 ms、857 次 sidecar 逻辑调用，其中 begin/commit 各 166 次；这是本机逻辑成本，不能替代桌面 IPC/延迟验收。


## 2026-09-14：跨宿主批量路径类型检查

VFS 的路径前缀检查使用不读取 sidecar 元数据的 getNodeType/statType，嵌套视图也保持该路径；同批前缀通过 Node statMany 或 Tauri fs_stat_many 读取，保留逐路径权限检查。宿主响应条数不匹配时拒绝所有等待者，单个链接不影响同批合法路径。

Node lstat 与 Rust symlink_metadata 保留符号链接/普通文件类型，Tauri 映射不丢字段，DirectoryDriver 不再把权限错误吞成空节点。真实文件系统回归复现了原先链接指向挂载根外文件并被读取的问题；修复后该视图读取被拒绝。此检查不构成抵御恶意并发替换路径的原子防护，也不替代原生进程沙箱。

读取与 rename journal 恢复仍处于同一事务；不使用实例内「日志曾经干净」作为跨进程跳过恢复的依据。真实两个进程覆盖读者先打开、写者在文件 rename 后 SIGKILL、原读者恢复目标记录的 root/module 两条路径。新增 sidecarStats 统计逻辑方法调用（含事务回调），不把该数字等同于真实 IPC 数。

本批完成批量类型检查、链接拒绝和跨进程恢复这条链；P0-02 的桌面 ≤2 秒 / ≤100 次 IPC 仍开放，需继续对正确实现减少宿主往返并重测。

隔离快照验证：VFS 175、LocalFS 69、Kernel 239、app-core 92、Tauri stat 映射 2、Rust 34 项通过，共 611 项；VFS/LocalFS/Tauri 类型检查、Tauri 前端构建与文档检查通过。未替代真实窗口及恶意路径替换竞态验收。


## 2026-09-14：并发文件保存与失败保留（进行中）

Node/Tauri 原先临时文件名按进程复用，同一路径并发保存可能共享临时文件而失败。Node 改为 UUID + wx 独占创建；Rust 通过 create_new 独占创建候选名，遇已有文件换名，不覆盖其他写者的临时内容。写入结束后 rename 发布，失败清理本次临时文件并保留原目标。

Node 三项回归覆盖 24 个独立实例的并发完整值、rename 失败保留、临时路径已被其他写者占有时不覆盖/删除；已提交基线中并发回归失败，当前实现通过。Rust 两项真实线程/文件系统测试覆盖并发完整值与发布失败保留，类型检查通过。本批尚未提交，准备与保存失败提示/重试形成完整功能批次；不把原子 rename 等同于断电 fsync 持久性或跨平台最终验收。


## 2026-09-14：跨宿主并发保存与编辑器失败重试

Node 使用 UUID + wx 独占创建临时文件，Rust 以 create_new 创建候选文件并跳过已占用名称；并发写入不共享临时文件，不覆盖其他写者的临时内容。写完后 rename 发布，失败清理本次临时文件，原目标保持。两端测试覆盖并发完整值与发布失败后的原内容/目录保留。

SaveManager 修复同步抛错后把已完成 Promise 留作正在保存、导致后续重试失效的问题；没有保存回调时最终保存直接返回并保留 dirty。真实 Node 文件写入接入 SaveManager 的回归覆盖：发布失败 → 原文件保留且 dirty → 编辑新内容 → 重试成功且 dirty 清除。

隔离快照：LocalFS 74、MDX 11、Rust 36 项测试通过，共 121 项；LocalFS/MDX/Tauri 类型检查、Tauri 前端构建与文档检查通过。P0-02 真实窗口保存失败/重试、其他平台行为与最终全仓验收仍开放；原子 rename 不代表断电 fsync 持久性。

## 2026-09-14：轮询快照失效复核（进行中）

尚未合入的读取复用在「读取期间通知」与「poll 后通知」两种交错下会保留旧空列表，使新定时器的唤醒计算返回 undefined。存储桩控制交错的两项回归修复前失败，修复后通过；无变更时仍复用扫描结果。快照在读取前建立占位，通知/重排/停止使其失效，读取结束仅在占位仍有效时发布；dispose 清理缓存。

当前工作树 Kernel 整包 249 项及类型检查通过。恢复 sweep 保留自身最新读取，复用仅覆盖恢复后的任务遍历、Effect 候选和下一次唤醒计算；不能称为全轮询只扫描一次。此部分待与调度/性能功能批次组合隔离验证，真实跨进程通知及桌面性能验收仍开放。


## 2026-09-14：调度扫描复用与空闲读取边界

Kernel 在恢复 sweep 后复用一次任务扫描供任务遍历、Effect 候选与唤醒计算使用；sweep/lease/CAS 保持自身最新读取。读取前建立快照占位，通知、重排、停止使其失效，读取结束仅在占位仍有效时发布，下一次唤醒消费一次后清除；其他 Session 的通知不清除当前 Session 快照，dispose 清理所有快照。

两项受控交错回归复现读取期间/读取后通知造成旧空列表忽略新 timer，修复后通过。七项快照测试覆盖上述边界；DOM 工作台在 MemoryBackend 和真实 LocalFS/SQLite 上静置一秒，VFS 与 sidecar 逻辑调用增量均为零。工作台测试的 Kernel facade 是桩，不代表完整运行时或桌面 IPC。

隔离验证：Kernel 246、Flow 213、app-shell 184 项通过，共 643 项，另有 30 项既有跳过；Kernel/CLI/Web 类型检查与文档检查通过。P0-02 桌面发送 ≤2 秒 / ≤100 次 IPC、真实窗口与跨进程通知矩阵继续保持开放。


## 2026-09-14：桌面 IPC 计量遗漏复核（进行中）

现有导出包装没有覆盖 Tauri core 内部 invoke：Resource.close、权限查询/申请、插件监听注册/移除及兼容 fallback 会漏计。实际 Vite 配置构建官方 Tauri 模块的回归在 Resource.close 处复现缺失；改为构建时给 core invoke 的统一入口计数，保留原调用与被冻结的宿主对象。官方入口形状变化则构建明确失败，避免悄悄漏计。

构建执行回归覆盖 event 相对导入、Resource.close、权限查询/申请、插件注册失败后的兼容重试及移除；trace 开启时各请求恰计一次，关闭时计数为空，诊断写入不计数。它证明公开模块及 core 内部调用覆盖，不证明 WebView 内部直接传输、重试/通道取数和动作边界已全部纳入；真实窗口 ≤2 秒 / ≤100 次验收仍开放。本批尚未合入。


## 2026-09-14：桌面诊断计量与动作边界

trace 构建在官方 Tauri core invoke 的统一入口计数，覆盖直接导入、event 相对导入、Resource.close、权限查询/申请、插件监听注册/移除及注册失败后的兼容重试；每次提交计数一次，不改写被冻结的宿主对象。入口形状变化会明确阻止构建，避免悄悄漏计。诊断文件追加显式绕过计数。

仅 VITE_MINDOS_TRACE=1 时注册 window.__MINDOS_TRACE__。验收驱动在选定起点调用 begin('send-to-provider') 保存返回 id，在对应终点调用 end(id) 获取同步快照并追加日志。时间使用 performance.now；VFS/sidecar/IPC 分别记差值，不读取命令参数。开始前与结束后的操作不计入动作，重叠动作独立计算，计数重置则拒绝结果；运行时释放时清理活动动作和全局接口。

日志 kind='action' 是指定动作的区间，kind='interval' 是周期区间，二者重叠，禁止相加当作总量。调用方必须把边界接到实际发送与 Provider 接收点；接口本身不证明边界已经正确放置。经过官方 core 的提交数也不等于全部 WebView 内部传输或底层重试。

隔离 app-shell 188 项通过，另有 30 项既有跳过；真实 Vite 配置编译/执行官方模块的 trace 开关回归通过，覆盖失败 fallback 与诊断旁路；Tauri 类型检查、开关两种完整前端构建及文档检查通过。P0-02 的真实窗口动作计量、通道取数/传输覆盖和 ≤2 秒 / ≤100 次目标保持开放。


## 2026-09-14：数据库初始化失败与定向释放

Tauri sidecar.close 显式传入当前 databaseUrl，避免无参数关闭所有池；初始化的 schema 读取、建表或版本检查失败统一释放本次池，失败与清理错误同时发生时保留 AggregateError 及原始 cause。事务内句柄不能关闭数据库池。通过真实 plugin-sql JavaScript 门面的宿主调用桩验证定向关闭、其他池继续可用及不兼容版本只关闭一次，不作为真实原生多池窗口验收。

LocalFS 不再把探针不可用、未知/空结果、普通探针关闭错误当成损坏。只在明确完整性诊断或 SQLITE_CORRUPT/SQLITE_NOTADB 时沿用重建流程，否则保留数据库文件并抛出原初始化错误。三个误删窗口修复前均实际导致测试文件被删，修复后保留；另补空结果边界，既有真实损坏数据库重建回归仍通过。

隔离 LocalFS 78、app-shell 193 项测试通过，共 271 项，另有 30 项既有跳过；LocalFS/Tauri 类型检查、Tauri 前端构建与文档检查通过。P0-02 真实窗口 Session 关闭/删除与故障恢复、完整持久性验收仍开放。


## 2026-09-14：只读挂载与源权限验收补充

新增回归覆盖 appendContent、createFile、直接 SeqFile setEntry 均返回 EROFS，且源内容、源记录和目录保持不变。多挂载 Session 视图的 SeqFile transaction 因缺少该能力返回 ECAPABILITY，事务回调未执行；这是事务能力边界，不是已进入事务后的只读检查。

来源本身只读时，申请 rw 挂载在配置阶段返回 EROFS，files 记录仍为空；随后申请 ro 能读取，不能写入。以上是既有实现的验收补充，最初测试对事务错误码与授权拒绝阶段的假设已按实际契约修正，未把测试假设错误记为生产缺陷。当前 app-core 全套 98 项与类型检查通过；将随挂载权限验收批次合入，P2-04 的真实窗口和平台故障矩阵保持开放。


## 2026-09-14：挂载权限与旧句柄撤销

Session 配置变更、禁用和服务释放会先同时关闭普通视图与工作区视图的入口，再等待已接受操作结束。此前顺序等待工作区读操作时，普通旧句柄仍能写入；IndexedDB/真实视图的受控在途读取回归已复现并验证修复。撤销失败会保留错误，不发布可用的新权限记录；这不是外部进程强制停止或跨主机 fencing 验收。

目录授权回归覆盖两 Session 同名挂载来源隔离、只读 write/append/create/rename/move/delete/metadata/tag/SeqFile setEntry 拒绝，以及源文件和记录不变。多挂载视图的 SeqFile transaction 返回 ECAPABILITY 且回调未执行，不能称为事务内 EROFS 检查。只读来源申请 rw 在配置阶段被拒绝且不留记录，改为 ro 可正常读取。

隔离 app-core 101、app-shell 193 项通过，共 294 项，另有 30 项既有跳过；app-core/Web/Tauri 类型检查与文档检查通过。P2-04 的真实窗口旧句柄路径、P0-02 设备不确认停止时的有界失败、跨进程/平台矩阵仍开放。
