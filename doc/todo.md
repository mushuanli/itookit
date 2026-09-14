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
  - 2026-09-14 发送边界计量：已接线 `SessionCommand.Send → Provider 响应头` 的 `send-to-provider` 动作（`apps/tauri-app/src/log/send-boundary.ts`，仅 trace 构建生效，有上界且不嵌套）。真实窗口两次独立样本为 **2870 ms / 1301 次公开 IPC** 与 **2731 ms / 1173 次**，`elapsedMs` 与按键→mock 收齐时间一致（2.6–2.7 秒）。**两个阈值均未达成**（延迟约 1.4 倍、调用约 12–13 倍）；延迟与 IPC 数近似线性（约 2.2 ms/次），瓶颈是宿主往返次数。热点为 `sidecar_select` 541、事务对 213+213、`fs_stat` 121；逻辑热点 `getRecordField` 376。减少 IPC 只能走原子批量操作（`vfsdriver-localfs/AGENTS.md` 禁止省略事务内的跨进程恢复检查），属未实施的设计，不能宣称完成。见[发送边界验收](minimal-system-acceptance.md#2026-09-14发送provider-动作边界的真实-ipc-计量)。
  - 2026-09-14 取消与失败可区分：终态错误带 `code: 'ABORTED'`，界面渲染 `data-outcome="cancelled"` 的中性气泡与「执行已取消」状态，并不再对取消显示连接配置入口；`packages/app-shell/tests/cancelled-history.test.ts` 覆盖 ABORTED/TIMEOUT/未标注三种形状，不靠消息文本猜测。
  - 2026-09-14 宿主在途消失：新增 `packages/app-shell/tests/host-restart-inflight.test.ts`，真实本地存储 + 永不回包的 HTTP 服务下，第一个宿主退出后重开仍能续发（转写不以用户消息结尾）。
  - 2026-09-14 独立关闭入口：新增 `SessionLifecycleService.closeSession`（停止运行、等待外部停止确认、**保留**存储/manifest/文档）与 Session 侧栏「关闭会话（停止执行，保留记录）」入口，与删除并列可区分；有界失败分别报告「records were kept」与「nothing was deleted」。见 `session-delete-lifecycle.test.ts`、`session-workbench.test.ts`。真实窗口已验收（挂起模型下点击该项，约 0.45 秒确认连接停止，Task 持久 `cancelled`，Session/Task 目录与记录保留），见[关闭保留验收](minimal-system-acceptance.md#2026-09-14运行中的-session-真实窗口关闭并保留记录)。
  - 已合入：并发文件保存与失败重试 `66dcf24c`、通知安全的轮询扫描复用 `6922e7da`、数据库未知初始化失败保留与定向关闭 `c0fd1568`；对应包级/原生回归不替代真实窗口验收。
  - 剩余：真实窗口的超时、Session 运行中单独关闭并保留记录、IPC 故障、发送回滚与保存失败/重试；设备不确认停止时的有界失败及数据保留；监控/取消的 live 与重开一致性。
  - 2026-09-14 真实窗口补验：模型请求在途时，通过列表右键和原生确认删除 Session；修复旧聊天/重试/ENOENT 残留，删除后恢复选择界面，同数据根重启未复活。app-shell 196 项通过，30 项既有跳过；见[删除收尾验收](minimal-system-acceptance.md#2026-09-14运行中-session-删除后的界面收尾)。该场景不替代设备不确认停止或其他故障矩阵。
  - 2026-09-14 窗口复核：修复选中 Session 后“+ 会话”落入虚拟目录而 ENOENT，根级/分组及附件目录回归、真实窗口新建同级会话通过。切工作区或会话均不关闭 Kernel Session；独立关闭并保留记录的窗口入口仍缺。约 60 秒模型超时已观察到持久 failed 和重开保留，但 live 状态及明确超时原因仍待收口。见[新建与关闭语义复核](minimal-system-acceptance.md#2026-09-14session-新建目标与桌面关闭语义复核)。
  - 2026-09-14 超时原因修复：驱动区分 TIMEOUT/ABORTED，保留首个中止原因并清理监听器；254 项相关测试通过、30 项既有跳过。真实窗口约 60 秒断开 HTTP，Task/Effect 持久 failed 且明确写明 60000 ms 超时；第一张终态截图仍有 RUNNING 残留，后续收敛不替代有界验收。见[模型超时验收](minimal-system-acceptance.md#2026-09-14模型超时与用户取消的原因保留)。
  - 2026-09-14 live 收敛上界：用约 0.5 秒分辨率采样（时间戳取每次无障碍遍历**返回之后**，修正上一轮先打时间戳再遍历把观测时刻标早的问题）测得——客户端在请求后 59994 ms 关闭连接，`effect.failed` 持久写明 60000 ms 原因于**+96 ms**，live 界面在**+0.75 秒与 +1.53 秒之间**收敛为终态（`Stop Generation` 消失、出现“重试”）。同数据根重启后转写正常渲染该 round，持久 round 文档为 `status:"failed"` + 同一原因。见[live 收敛验收](minimal-system-acceptance.md#2026-09-14模型超时的-live-收敛上界与重开原因)。边界：AT-SPI 文本节点名为空，未重新断言屏幕文本；pause 三态与未确认物理停止的真实窗口场景仍未完成。
  - 2026-09-14 取消提示收口：ABORTED 事件与失败区分，顶部/卡片显示“执行已取消”和“重新执行”，历史取消原因区使用中性色；真实停止按钮验证通过，320 项相关回归通过、30 项既有跳过。见[取消终态文案](minimal-system-acceptance.md#2026-09-14取消事件与界面终态文案)。不替代未确认停止、pause 和状态收敛要求。
  - 补真实 GUI 的“请求已接受 / 状态已变化 / 外部已停止”区分，以及 pause 同类文案。活动 CLI Run 只能由拥有者取消；另一 CLI 进程拒绝越过 Session 租约。
  - 见[验收 §11–19、§23–27](minimal-system-acceptance.md)及 `run-control.test.ts`、`session-delete-lifecycle.test.ts`。

- [x] **P0-03 可复用运行入口与交付说明**
  - [运行说明](minimal-system.md)已覆盖启动、隔离数据根、Provider/Connection、目录授权、子进程凭证注入与预期结果。
  - 用户决定保持 API Key 明文落盘；设置页已注明路径和 Session Bash 不继承宿主环境，见[验收 §28](minimal-system-acceptance.md)。不重新引入密钥环方案。

- [ ] **P0-04 平台实机验证**
  - 已有 Linux bwrap/目录/符号链接边界、取消/超时、缺隔离器拒绝、Xvfb/AT-SPI 窗口与应用内目录授权证据。
  - 剩余：其他目标平台的支持范围及真实行为、原生 GTK 目录选择器（仅验证到弹出：见下）、发布产物的支持边界；多层级嵌套挂载已按上条收窄为「单挂载内的嵌套目录树」并验证。Skill 面板真实勾选/取消及重开持久身份已于 2026-09-14 验收通过（见 P0-00）。
  - 2026-09-14 桌面字体/导航补验：10 个本地 FontAwesome 字体面在真实 WebView 加载成功，修复 Vite 内联小字体被 CSP 拦截；11 个静态导航控件具有稳定 AT-SPI 名称。文件列表仍有方框字符，需继续核对来源与系统字体回退，不能把字体加载通过等同于全部图标渲染通过。见[字体与导航验收](minimal-system-acceptance.md#2026-09-14桌面本地字体与导航可访问名称)。
  - 2026-09-14 边界收口（见[平台边界验收](minimal-system-acceptance.md#2026-09-14p0-04-平台边界图标字体与原生目录选择器)）：**方框字符根因已定位**为宿主缺少 emoji 字体——列表图标是 `@itookit/common` 的 emoji 码位，而本机 `fc-list ':charset=1F4C1'`/`1F5D1`/`2795` 均为 0 条，应用不自带该字体；属支持边界而非本轮代码回归。**原生 GTK 选择器**经 XDG Portal 真实弹出 `Select Folder`（含文件选择小部件与 `取消/打开`），但**未能完成选择**：合成输入会破坏 GTK 位置栏路径（实测 `/ome/…`、`/home/lli/…`），且容器无 `/dev/fuse` 使门户文档门户不可用，未产生挂载记录。**发布产物**未构建（无 AppImage/linuxdeploy 工具、无网络）；受版本控制的 `release/dist/` 停留在 2026-09-04。**其他平台未验证**，不能由 Linux 证据外推。
  - 2026-09-14 嵌套边界收窄（见[嵌套规则验收](minimal-system-acceptance.md#2026-09-14项目规则在真实窗口的嵌套边界p0-04)）：**「多层级嵌套挂载」在本实现不可表达**——`SessionFilesService.create` 要求挂载点 `at` 匹配 `^\/[a-zA-Z0-9_-]+$`（单段），`at: '/workspace/inner'` 实测抛 `EACCES Reserved or invalid mount point`；真正存在的嵌套是**一个挂载内部的多层目录树**。按此收窄后在真实窗口验证：单挂载 `/workspace` 的树内含 `inner/_agent/AGENT.md` 与 `inner/_agent/skills/...`，请求体出现 `OUTER-PROJECT-RULE-MARKER`(1) 与 `OUTER-SKILL-BODY-MARKER`(1)，`INNER-NESTED-RULE-MARKER`(0) 与 `INNER-SKILL-BODY-MARKER`(0)，即内层项目规则不合并、不替换。cwd 等于项目根时内层 Skill 不级联（级联需更深 cwd，属 Flow/工作区作用域路径，本场景未覆盖）。
  - 2026-09-14 选择器静默失败已修（见[静默失败验收](minimal-system-acceptance.md#2026-09-14原生目录选择器的静默失败p0-04)）：`openDirectoryDialog` 原为 `catch { return null }`，把“取消”与“选择器损坏”合并，且点击处理没有 `catch`，失效时唯一症状是按钮无反应。现抽出 `apps/tauri-app/src/services/directory-dialog.ts`：取消返回 `null`，真实失败记录并重新抛出；点击处理报告挂载/选择失败。回归 `packages/app-shell/tests/directory-dialog.test.ts` 3 项通过。**验证缺口**：改动后本环境合成输入不再激活窗口（诊断标题从未改变，同期导航点击也失效），因此修复后的端到端行为未在窗口复验；门户选择失败的确切形态（reject / null / 挂起）仍未判定，原生选择器在本机的可用性**未结论**。
  - Tauri Session Bash **共享宿主网络**；无出网或连接超时不能当作网络沙箱证据。见[验收 §29](minimal-system-acceptance.md)。

- [ ] **P0-05 当前最终回归**
  - 旧树 `d883a497` 的阶段性矩阵已完成并保留在[验收记录](minimal-system-acceptance.md)，不能作为后续大量改动后的最终通过证据。
  - 2026-09-14 统一测试入口批次：以 `a308eb65` 加本批选定文件的隔离快照运行 `pnpm test`，Vitest 1,593、调度器 3、Rust 36 项通过，共 1,632 项；30 项既有跳过。CLI 107 项与 SIGKILL 矩阵 10 项分开执行；CLI 类型与文档检查通过。Node 26.8.1 / pnpm 10.20.0，复用本机依赖与 Rust 编译缓存，未做全新依赖安装验证。这是当前入口的阶段性回归，不是最终全仓/GUI 验收。
  - 2026-09-14 类型/构建入口批次：补齐六个 workspace 的 typecheck，24 个实际执行通过；Web/Tauri 文件列表覆盖 app-shell 全部 12 个 src TS 文件，demo 仍为手工 JS 示例。20 个库和四个应用构建、冻结锁文件核对、tsx 子进程三项 SIGKILL 回归通过。见[清单验收](minimal-system-acceptance.md#2026-09-14类型检查覆盖与包清单收口)。未替代最终全矩阵、全新安装或 GUI。
  - 2026-09-14 当前树全量批次：工作树 `3c3afe5d`（`git status` 干净），按 §4 入口逐条执行，11 个阶段全部 rc=0——typecheck 25 个 workspace、`docs:check`、`styles:check`、20 个库构建、CLI/前端构建、`cargo test` 36 项、包测试 **1508 通过/30 跳过**、CLI 非崩溃 **108**、crash-matrix **12**、`custom-protocol` 原生构建、调度器 **3**，合计 **1667 项通过 / 30 项跳过**。见[当前树全量回归](minimal-system-acceptance.md#2026-09-14当前树全量回归p0-05-阶段批次)。
  - 仍未达最终验收：P0-02 性能阈值未达成、P0-04 尚有未做窗口场景；未做全新依赖安装，未构建发布安装包（`bundle.targets: "all"`，本机无 AppImage/linuxdeploy 工具且无网络）。受版本控制的 `release/dist/` 停留在 2026-09-04，与当前树不同步，本轮未重新生成。
  - 待其余有效要求闭合后，对最终工作树执行类型、文档、样式、库/CLI/前端/原生产物构建、全量测试矩阵与真实窗口验收，记录版本、命令、结果和剩余跳过项。

### P1：完备的本地 Durable/Flow 运行

**当前范围（用户于 2026-09-14 收窄）**：单主机、当前版本、本地事务存储，CLI/Tauri 可运行、可控制、可恢复、可重开核对。保留同机多进程/多 Session 的正确性；迁移、跨主机执行及通用分布式协议不再是本地 P1 的完成条件。细分边界见[本地 P1 设计](design/p1-transition.md)。下面区分待实现与待验收，不按旧设计章节是否全部实现决定完成。

- [x] **P1-01 本地崩溃恢复闭环**
  - 已实现：稳定 requestId/spec 去重、根和检查点持久化、循环/patch/委派恢复；不确定 Effect 默认阻断，显式授权才重放。提交/检查点间隙、委派在途、已完成循环迭代已有真实 SIGKILL 回归。新增根提交后、首检查点前的真实 SIGKILL 回归；初始调度/工作区身份与根同事务持久，终态到收尾 pending 的窗口也可恢复。
  - 已补验证：首个能力回执后、Task.start 后、动态 patch 检查点前、委派全部完成但根 join 信号前四个真实 SIGKILL 窗口；恢复保持 Task 身份、已完成输出及模型调用次数。结果不确定时仍阻断并要求显式裁决，不追求外部服务恰好执行一次。
  - 入口：`apps/cli/tests/crash-matrix.test.ts`、`packages/llm-flow/__tests__/durable-flow-executor.test.ts`、[验收记录](minimal-system-acceptance.md)。

- [ ] **P1-02 同机所有权与全部本地控制入口**
  - 已实现：Session/Run 租约、epoch、CLI 本机锁；Run 到期即失效、迟到心跳不续活；节点提交、共享状态和根信号在事务内检查所有权；失权不触发失败清理。
  - 待实现/核对：取消、pause/resume、图重试、委派兄弟取消、资源授权及工作区清理的旧句柄/迟到回调路径。已补 TaskHandle cancel/pause/interrupt/resume/start/signal/retry、资源创建和预算事务 guard；后台委派在截止前保留所有权，终态恢复也收敛后台任务。独立 DAG 命令已接上 Session 写权限门、工作区管理器以及本 Kernel 的 Run 租约；失权/异宿主控制被拒，HITL 响应同样事务校验。同机并发控制串行化，重复 retry 复用回执；暂停/恢复仅作用于当前 Run，不再暂停整个 Session。
  - 待验收：同机两个进程争用、旧宿主暂停后恢复、租约失效后迟到请求；清理不确认时已在 5 秒后持久记录 pending 说明，桌面显示且 CLI 退出等待期间报告；继续保留数据和租约，确认停止后才清理。保留本机时钟变化的安全失败边界，不实现跨主机时钟协议。

- [ ] **P1-03 本地工作区与委派可用性**
  - 已实现：CLI/Tauri worktree、持久创建意图与租约、文件/进程/cwd 一致、detached deadline 恢复、pending 收尾、脏副本保留；已有真实 LocalFS/SQLite/Kernel/Flow SIGKILL 和 Tauri IPC/bwrap 探针证据。
  - 待实现/核对：授权变化或 Kernel 无法发现 Session 的遗留意图已保留并报告具体路径和处理建议；工作区恢复失败释放调度租约，清理等待保留租约与文件并有界报告。CLI YAML 已提供有界 delegation 配置、Agent 引用检查及父子工具交集，真实 SIGKILL 回归已改为经 YAML 配置。
  - 待验收：用户窗口启动工作区 Flow、真实桌面重启、失败/取消/保留脏副本、人工合并路径。完整自动合并与冲突编辑器后移，先保证报告冲突、保留分支和工作区供用户处理。
  - 平台边界：当前 Linux 原生/bwrap 为本地验收目标。OCI 不是基础 P1 前置条件；若选择或声称支持 CLI OCI/read-only 模式，则必须独立真实验收，不能用原生模式冒充只读隔离。

- [ ] **P1-04 图级 retry 与本地控制验收**
  - 已实现：图级/委派组/隔离工作区重算、下游取消、代数更新、token 退款、DagWorkbench 入口；直接以合成委派子节点为重试源仍拒绝。
  - 剩余主要是验收：真实窗口重算操作、结果收敛、live 与重开一致；发现问题再修复。旧拥有者重试/取消的命令隔离归 P1-02，不重复开发已有图重算。
  - 入口：`graph-retry.test.ts`、`durable-flow-executor.test.ts`、`dag-run-retry.test.ts`。

- [ ] **P1-05 现有本地存储与资源生命周期**
  - 已实现：预算 usageId 幂等、Task/Session cache 清理、消息结算确认与保留、history/event 裁剪水位、现有资源申请/释放/清理回执和布局识别。
  - 剩余：现有本机多 Session 的消息/receipt/GC 竞争、重启后清理重试、未确认物理停止不释放容量；验证恢复所需事实不被裁剪、旧回执不复活资源、本地预算不重复结算。补故障测试并修复实际缺陷，不为对齐目标表名重构存储。
  - 不要求：Storage §5 全量记录族拆分、account/allocation/export/import 通用服务、可插拔 cache provider、可恢复业务字节流、真实供应商收费幂等、多 store 迁移。
  - 完整设计对照仍见[证据映射](design/durable-harness-evidence.md)，其中扩展缺口不阻塞当前本地 P1。

- [x] **P1-06 Transcript 存储分页与导出**
  - 物理分页、固定版本、maxBytes 裁剪及水位、CLI 真实文件导出、UI 独立遍历分页导出已有证据；UI 导出保留单调性和 10k Effect 上限守卫。
  - 入口：`transcript-budget.test.ts`、`task-transcript-dialog.test.ts`、CLI `run.integration.test.ts`。

- [x] **P1-07 本地节点输出契约**
  - 已实现：受支持 schema 子集与同 id 跨版本兼容、所有生产者输出独立验证、Run/动态图及清单/schema 冻结；无效输出使 Run 失败，不派发严格下游，原输出保留。
  - 已补齐：节点 `portSchemas` 输入/输出引用及内联定义、Agent responseFormat 到解析后 result 的绑定；发布/直接执行/动态图/恢复复用冻结目录，同身份不同定义和削弱插件契约被拒绝。CLI YAML 提供 `response_format` / `output_validation` / `port_schemas`；原文保留在 Task，具体错误进入 Run，沿用既有 transcript 与人工重试入口。真实 CLI 正反例及 Flow 回归证明严格端口不会被 Agent continue 绕过。
  - 当前策略：Flow 端口默认 fail，使用已有人工修正/重试路径；Agent 内部已有 repair/continue 保留。通用自动修复 Task、invalid 分支 DSL、任意 schema 转换及插件产物版本仓库不作为本地 P1 前置条件。
  - 当前版本运行并重启应可恢复；不支持契约漂移时静默续跑。跨应用版本升级迁移与旧插件包自动归档后移。

- [x] **P1-08 Effect 回滚缺陷**：Skill 身份持久化失败只回滚本次新加载，清理逐项执行并聚合原始/清理错误；`create-kernel-adapters-runtime.test.ts` 有回归。
- [x] **P1-09 CLI supervisor 累积结果**：回边使用来源最新已完成实例，支持轮流派发 worker；普通 Loop 语义保持，CLI/Flow 已有回归。
- [x] **P1-10 CLI 非交互监控窗口**：持久根建好后及时发布 live 句柄，调度期失败写入 Run；Tauri 监控/取消窗口剩余验收归 P0-02。

本地 P1 完成标准：上述本地路径全部闭合，执行最终工作树的相关测试/类型检查与真实 CLI、桌面验收；不存在靠直接改持久记录或仅靠测试夹具才能使用的核心能力。P0 的性能、发布包及其他平台验收保持各自归属，不重复算作 P1 实现任务。

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
