# 目标、进度与后续任务

更新：2026-09-14。**整体目标未完成，完整桌面最小系统尚未验收通过。** 本文只维护当前状态、剩余要求和证据入口；逐轮经过见[9 月 13 日归档](deprecated/todo-progress-2026-09-13.md)与[9 月 14 日归档](deprecated/todo-progress-2026-09-14.md)，实机步骤见[最小系统验收记录](minimal-system-acceptance.md)。

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
  - 2026-09-14 补齐真实面板操作：滚动设置面板后点击 Skill 复选框，完成加载 → 重开保持 → 卸载 → 重开不复活；四段分别核对模型 system 消息与持久身份，未直接修改加载记录。见[复选框验收](minimal-system-acceptance.md#2026-09-14skill-复选框真实加载卸载与重开)。多层级嵌套挂载的真实窗口场景仍归 P0-04。

- [x] **P0-01 完整 Tauri 调用链**
  - 真实窗口 → 外层 harness → Bash/IPC/bwrap → CLI 子 DAG → 结果和退出码，重开 transcript 已通过。应用内挂载对话框建授权亦通过。
  - 见[验收 §3、§18、§20](minimal-system-acceptance.md)。模型为本地 mock；其他失败场景归 P0-02。

- [ ] **P0-02 应用级失败、取消与性能闭环**
  - 2026-09-14 恢复复核：两个真实进程下，已打开读者未发现另一进程 SIGKILL 遗留 rename intent，root/module 两条回归均复现。已移除实例内 journal 干净缓存，读取与恢复处于同一事务。修复已随 `6af6e452` 合入；修复后 Node 探针为 62 ms / 857 次 sidecar 逻辑调用，替代此前依靠跳过恢复检查的数字，不代表桌面 IPC。
  - 已验证：CLI 超时/SIGINT/进程树停止；Session 关闭等待确认；真实窗口取消及重开后的 ABORTED/原因保留；撤销挂载后工具 FAILED、重开仍保留工具与错误；只读挂载拒绝写入。文件保存失败会提示并保留 dirty。
  - 空闲目标已达成：既有真实窗口 70 秒 VFS 0、sidecar 32 次（约 0.46 次/秒）。此前真实窗口发送 ping 到 mock 收齐请求为 **2.707 秒**，仍未达 **≤2 秒 / ≤100 次调用**；覆盖发送的两个 trace 区间共 953 次公开 API 请求，但含边界外操作，不是精确发送计数。已合并资源清理候选事务并减少目录/批量读取的重复解析；桌面动作边界与官方 core 内部调用计量已在 `f814d609` 合入，但真实发送/Provider 收齐边界尚未接线，通道直接传输仍待覆盖。继续按正确读取实现重测，见[运行时诊断](runtime-architecture.md)、[验收 §70](minimal-system-acceptance.md)。
  - 已合入：并发文件保存与失败重试 `66dcf24c`、通知安全的轮询扫描复用 `6922e7da`、数据库未知初始化失败保留与定向关闭 `c0fd1568`；对应包级/原生回归不替代真实窗口验收。
  - 剩余：真实窗口的超时、Session 运行中单独关闭并保留记录、IPC 故障、发送回滚与保存失败/重试；设备不确认停止时的有界失败及数据保留；监控/取消的 live 与重开一致性。
  - 2026-09-14 真实窗口补验：模型请求在途时，通过列表右键和原生确认删除 Session；修复旧聊天/重试/ENOENT 残留，删除后恢复选择界面，同数据根重启未复活。app-shell 196 项通过，30 项既有跳过；见[删除收尾验收](minimal-system-acceptance.md#2026-09-14运行中-session-删除后的界面收尾)。该场景不替代设备不确认停止或其他故障矩阵。
  - 补真实 GUI 的“请求已接受 / 状态已变化 / 外部已停止”区分，以及 pause 同类文案。活动 CLI Run 只能由拥有者取消；另一 CLI 进程拒绝越过 Session 租约。
  - 见[验收 §11–19、§23–27](minimal-system-acceptance.md)及 `run-control.test.ts`、`session-delete-lifecycle.test.ts`。

- [x] **P0-03 可复用运行入口与交付说明**
  - [运行说明](minimal-system.md)已覆盖启动、隔离数据根、Provider/Connection、目录授权、子进程凭证注入与预期结果。
  - 用户决定保持 API Key 明文落盘；设置页已注明路径和 Session Bash 不继承宿主环境，见[验收 §28](minimal-system-acceptance.md)。不重新引入密钥环方案。

- [ ] **P0-04 平台实机验证**
  - 已有 Linux bwrap/目录/符号链接边界、取消/超时、缺隔离器拒绝、Xvfb/AT-SPI 窗口与应用内目录授权证据。
  - 剩余：其他目标平台的支持范围及真实行为、原生 GTK 目录选择器、P0-00/P0-02 等尚缺窗口场景、发布产物的支持边界；其中仍含多层级嵌套挂载下的项目规则窗口场景。Skill 面板真实勾选/取消及重开持久身份已于 2026-09-14 验收通过（见 P0-00）。
  - 2026-09-14 桌面字体/导航补验：10 个本地 FontAwesome 字体面在真实 WebView 加载成功，修复 Vite 内联小字体被 CSP 拦截；11 个静态导航控件具有稳定 AT-SPI 名称。文件列表仍有方框字符，需继续核对来源与系统字体回退，不能把字体加载通过等同于全部图标渲染通过。见[字体与导航验收](minimal-system-acceptance.md#2026-09-14桌面本地字体与导航可访问名称)。
  - Tauri Session Bash **共享宿主网络**；无出网或连接超时不能当作网络沙箱证据。见[验收 §29](minimal-system-acceptance.md)。

- [ ] **P0-05 当前最终回归**
  - 旧树 `d883a497` 的阶段性矩阵已完成并保留在[验收记录](minimal-system-acceptance.md)，不能作为后续大量改动后的最终通过证据。
  - 2026-09-14 统一测试入口批次：以 `a308eb65` 加本批选定文件的隔离快照运行 `pnpm test`，Vitest 1,593、调度器 3、Rust 36 项通过，共 1,632 项；30 项既有跳过。CLI 107 项与 SIGKILL 矩阵 10 项分开执行；CLI 类型与文档检查通过。Node 26.8.1 / pnpm 10.20.0，复用本机依赖与 Rust 编译缓存，未做全新依赖安装验证。这是当前入口的阶段性回归，不是最终全仓/GUI 验收。
  - 2026-09-14 类型/构建入口批次：补齐六个 workspace 的 typecheck，24 个实际执行通过；Web/Tauri 文件列表覆盖 app-shell 全部 12 个 src TS 文件，demo 仍为手工 JS 示例。20 个库和四个应用构建、冻结锁文件核对、tsx 子进程三项 SIGKILL 回归通过。见[清单验收](minimal-system-acceptance.md#2026-09-14类型检查覆盖与包清单收口)。未替代最终全矩阵、全新安装或 GUI。
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
  - 已合入 `fb059403`：同一事务存储内的资源 authority 身份、epoch CAS、排队申请接管检查与 managed schema 升级；不等于物理执行端或跨存储 fencing。
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
  - 已合入 `f8c1f181`：普通与工作区视图同时关闭入口再等待在途操作；配置变更、禁用和释放均有受控交错回归。只读来源拒绝 rw 授权；多挂载 SeqFile transaction 返回 ECAPABILITY 且不执行回调。
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
| 其余有效设计 | [VFS 总设计](design/VFS-design.md)、[实现状态](design/vfs-implementation-status.md)、[C4 核验](design/vfs-c4-review.md)、[运行时诊断](runtime-architecture.md)、[标签存储](design/label-storage.md) |

最近已提交批次（逐批隔离验证，**不是当前整树最终矩阵，不累加为独立测试总数**）：

| 提交 | 功能 | 当批通过项数 |
| --- | --- | --- |
| `f8c1f181` | 挂载权限与旧句柄撤销 | 294；30 项跳过 |
| `c0fd1568` | 数据库失败保留与定向关闭 | 271；30 项跳过 |
| `f814d609` | 桌面 IPC 计量与动作边界 | 188；30 项跳过；另有真实 Vite 开关构建探针 |
| `6922e7da` | 调度扫描复用与空闲读取 | 643；30 项跳过 |
| `66dcf24c` | 跨宿主并发保存与编辑器重试 | 121（含 Rust） |
| `6af6e452` | 批量类型检查、链接拒绝与跨进程恢复 | 611（含 Rust） |
| `fb059403` | 资源 authority 事务隔离 | 771 |
| `bfe3cbf4` | 缓存与已确认消息保留 | 759 |

各批类型/文档检查和测试边界见[归档](deprecated/todo-progress-2026-09-14.md)。原始日志在临时目录，长期复核应使用对应提交的测试与命令重新执行。真实窗口的历史数据不能证明这些提交后的性能。

从仓库根目录执行，按改动先跑相关包；最终验收不能省略完整矩阵与实机步骤：

```bash
pnpm typecheck
pnpm docs:check
pnpm styles:check
pnpm build:libs
pnpm --filter @itookit/cli build
pnpm --filter tauri-app build
cargo test --offline --manifest-path apps/tauri-app/src-tauri/Cargo.toml
pnpm -r --filter '!@itookit/cli' test
pnpm --filter @itookit/cli exec vitest run --exclude tests/crash-matrix.test.ts
pnpm --filter @itookit/cli exec vitest run tests/crash-matrix.test.ts
cargo build --offline --features tauri/custom-protocol --manifest-path apps/tauri-app/src-tauri/Cargo.toml
```

统一入口：`pnpm test`（别名 `pnpm test:matrix`）先执行调度器回归，再按 workspace 顺序运行包测试、CLI 非崩溃测试、独立 CLI crash-matrix 和 Rust 边界测试。任一阶段失败立即停止；从任意目录直接执行脚本也固定使用仓库根目录。llm-tasks 默认 test 不进入 watch，编辑器已有测试纳入入口。

覆盖边界：包测试沿用各自 Vitest 配置及既有跳过；无测试文件的包不自动获得行为验收。测试入口不执行类型、样式、构建或真实 GUI，这些仍按 P0-05 单独验证。Session 删除测试等待已持久的 waiting 状态后再检查活任务删除屏障，避免把异步调度时机误当功能失败。

后端/网络/GUI 操作受环境限制时通过正常权限机制重试，不能把未执行当通过。保护已有工作树修改，不擅自回滚或提交；无明确授权不启动子代理。Xvfb 已用于真实窗口验收，AT-SPI 需要可写缓存与显示会话；临时探针入口、前端和原生二进制均需恢复为正常版本。`/tmp` 日志会消失，长期证据以测试源文件与可复现验收记录为准。

## 5. 文档维护规则

- 本文保留当前任务状态，每项只写“已实现 / 剩余 / 证据”，不追加逐轮流水账。
- 详细实验步骤、数据根、截图、命令和结果放入[验收记录](minimal-system-acceptance.md)，设计决策更新对应活文档。
- 已完成行若仍含有效未完成要求，应拆开或取消总项勾选；不能通过删掉要求来闭合任务。
- 历史快照仅供定位：[清理前完整进度](deprecated/todo-progress-2026-09-13.md)。历史计数、旧工作树和已被取代结论不作为当前完成证明。
