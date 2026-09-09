# 设计与代码同步核验

> ⚠️ 已归档：2026-09-08 时点扫描台账，仅作证据留档，不代表当前状态。进度见 `../todo.md`。

日期：2026-09-08。目标：扫描本目录全部设计，核对当前代码并完成仍有效的未完成任务。整体尚未完成；下表是后续工作的检查入口，不能当作全量验收证明。历史方案已经明确被取代的迁移步骤不重新实施，仍有效的正确性和安全要求继续核验。

## 当前优先级：最小可运行系统

用户要求优先完成 durable kernel、Skill、DAG 的最小可运行系统。原设计全量任务继续保留，但跨 Session Memory、Skill 自动委派、完整 Schema 扩展暂后移；下一步先补实际应用启动、界面执行及失败/取消/人工回应闭环的验收证据。

用户进一步明确：**最小系统必须包含 Tauri Bash 工具，以及通过 Bash 启动子 harness 并执行简单 DAG；Web 暂保留接口。** 验收链为 Tauri 外层 harness→标准 tool.call/Bash→真实 Bash 命令→仓库 CLI 子 harness→简单 DAG→退出状态/输出回传。需验证 Session 工作目录与授权边界、stdout/stderr/exit code、超时/取消及持久 Task/Effect 记录；不以单独 shell IPC 或模拟模型测试替代该链。

当前源码证据：Tauri main.ts 现已通过 createTauriSessionProcesses 注入 Session shell；AppKernelPlatform 现已提供 createSessionProcesses 接口及工具上下文装配；宿主 shell_exec 已改为 Bash 并分开输出流；Session 使用独立 session_shell_exec 与显式目录句柄映射。平台接口与工具装配已接通，Bash 工具启动真实 CLI 子 harness 的组合测试已通过，外层持久 Effect 及重开结果已通过组合测试，后续优先补完整 Tauri 应用调用与 CLI 人工暂停后的调度恢复。Web 不启用本机执行。CLI 子 harness 采用仓库现有入口。人工回应后的下游调度已修复，证据如下。

**人工回应后的调度延续已修复，仍需完整应用验收。** 原 human→transform 组合测试复现回应后根 succeeded 但下游不存在。现等待交互时发布同一等待中的 Run，后台调度继续等待回应并提交后续节点；最终通过持久信号告知该根任务开始汇总，新增成员保存为 Run 记录。三项 LocalFS 组合测试通过，包括 Skill→Agent→transform、单次人工回应和连续两次人工回应，验证同一 Run 的下游输出及重新连接成员。目前另有 CLI 人工交互检查点的跨进程恢复验收（见下文）；任意崩溃点的完整调度恢复仍未完成。日志 `/tmp/minimal-human-dag-fixed.log`。

| 最小链路 | 当前证据与缺口 |
| --- | --- |
| Web 生产构建与类型 | mind-os build/typecheck 通过，日志 `/tmp/minimal-system-web-build.log`、`/tmp/minimal-system-web-types.log`；构建仍提示部分 Node 模块浏览器外置，需实际页面验证是否可达 |
| Skill 面板→持久加载→DAG 输入 | 新增 app-shell `minimal-skill-dag.test.ts`，真实面板事件、SessionSkillControls、Skill 服务与 Kernel；加载后的指令实际进入 Agent Effect 请求 |
| DAG 执行与依赖传值 | 同测试执行 Agent→transform 两节点数据边，固定模型响应进入下游输出，根任务 succeeded；模型为测试 Effect，不是外部模型服务 |
| 重开持久结果与 Skill 状态 | 同测试关闭 Kernel/Skill 服务/LocalFS 后重新装配，从 SQLite 读回相同根结果、transcript 和加载身份，再恢复 Skill 指令；不是运行中 DAG 调度恢复 |
| 实际页面与应用装配 | 当前环境无可用浏览器，组合测试没有调用完整 initApp，尚不能称完整 GUI 端到端验收通过；实际模型配置、失败/取消/人工交互的组合验收继续优先 |

此前 Skill→Agent→transform 组合测试通过，日志 `/tmp/minimal-skill-dag-tests.log`。它将此前分散的 Kernel、Skill 面板、DAG 与 LocalFS 验证串联为一条可重复运行的本地最小链；新增人工交互组合测试现已通过；真实页面、Tauri Bash→子 harness 链仍未完成，不能扩展成最小系统全部验收通过。

### Session 进程平台接口接线

AppKernelPlatform 新增 createSessionProcesses，在取得 Session 文件上下文后创建平台 nativeShell/可选 ttyDriver，传入既有 KernelAdapters 的 Session 工具作用域。Bash 已在 BUILTIN_TOOLS 中，注入 nativeShell 后即可通过标准工具调用，无需另造 Bash Effect 入口。Web 未配置 factory 时保留文件上下文且无本机 shell。作用域释放先停止平台进程，再释放文件视图；平台初始化失败会释放已获取的文件上下文，并发释放共享一次清理结果。

四项测试通过，覆盖真实 ToolService/Bash 调用、两个 Session 的 cwd/返回结果隔离、Web 无 provider、初始化失败及清理失败/并发释放。mind-os 类型检查通过，日志 `/tmp/minimal-session-process-tests.log`、`/tmp/minimal-session-process-types.log`。该阶段平台 shell 为测试替身，当时 Tauri 接线和人工回应仍有缺口；后续已完成接线、子 harness 验收与人工回应修复，以下小节记录对应证据。

### Tauri 原生 Bash 与结果协议

shell_exec 现在通过独立 bash_process 模块启动 `bash --noprofile --norc -c`，移除 BASH_ENV，返回独立 stdout/stderr/exit code。TauriNativeShell 同时接受工具现有 sh 调用和显式 bash 调用，两者均走该 Bash 后端；取消使用相同 requestId，结束后移除监听。修正旧注释，不再把 BashTool 的命令字符串过滤描述为 Session 授权隔离。

独立 rustc 测试两项通过，实际执行 Bash 数组语法、分别捕获输出/错误/非零退出码，并执行嵌套 Bash 检查 cwd。四项 TypeScript 桥接测试和 tauri-app 类型检查通过，日志 `/tmp/minimal-tauri-bash-ts-tests.log`、`/tmp/minimal-tauri-bash-types.log`。独立模块编译不替代完整 Tauri Cargo/GUI 验收；Session 工厂、宿主路径授权映射、真实子 harness 仍待接通。

### Tauri Bash 进程树取消与超时

shell_exec 改为异步 Tauri command，并将进程等待放入 spawn_blocking，避免同步执行阻塞取消命令。运行请求在启动前登记共享取消标记，重复活动 requestId 被拒绝；取消与超时由等待循环处理，先 TERM 再 KILL Unix 进程组，最终回收 shell。一次性命令结束也关闭遗留组内子进程，避免其继承输出管道导致 join 一直等待；需要持久后台进程的功能应使用独立生命周期接口，不能依赖一次性 Bash 工具脱管。

独立 Rust 模块四项真实测试通过，新增忽略 TERM 的子进程超时退出、运行中进程组取消，日志 `/tmp/minimal-tauri-bash-process-tests.log`。本次完整 cargo check --offline 已尝试，因缺少 gdk-3.0 系统开发库失败，日志 `/tmp/minimal-tauri-process-cargo.log`；因此 Tauri command 宏/整机编译和真实 GUI 仍未验收。Windows 进程树隔离也不由 Unix 进程组测试证明。Session 授权接线及子 harness 仍为最小系统待办。

### 人工回应后同一 Run 的调度延续

修复 executor 在 pending interaction 时提前结束整个调度循环的问题。等待交互时发布等待中的根任务并继续当前调度器；新增节点同步到活动句柄与持久成员清单，调度完毕后再驱动同一根汇总。调度异常会向等待根报告失败；Kernel 销毁停止当前进程驱动，未声称完成持久调度恢复。

原失败组合测试已通过，并增加连续两个人工节点的测试，验证原 Run 在第二次等待时仍未成功、回应后下游执行且重连成员完整。Flow 124 项、Session 65 项、app-shell 128 项通过（30 项跳过），Tauri 类型检查通过。日志 `/tmp/minimal-human-dag-fixed.log`、`/tmp/minimal-human-flow-tests.log`、`/tmp/minimal-human-session-tests.log`、`/tmp/minimal-human-app-tests.log`、`/tmp/minimal-human-flow-types.log`。下一优先项仍是 Tauri Session Bash 授权接线及子 harness/DAG 真实调用。

### Session Bash 的 Linux 目录隔离执行器

新增 session_bash 原生模块，通过 Bubblewrap 将显式 Session 授权目录映射到虚拟挂载点，区分 ro/rw，要求 cwd 位于授权挂载中，拒绝遍历路径和覆盖 /usr、/etc、/proc 等运行时目录。运行时二进制/库与解析器/证书只读可见，/tmp 独立，环境清空后仅设置基本 PATH/HOME/LANG；网络当前共享宿主网络，未宣称网络隔离。非 Linux 平台明确返回不支持，不回退到无隔离的宿主 Bash。

本机 Bubblewrap 实际可运行。两项独立 Rust 测试通过，真实嵌套 Bash 能读取授权只读目录并在读写工作区写入，不能写只读目录，也看不到未挂载的宿主测试文件；无授权 cwd、保留路径和遍历路径被拒绝。日志 `/tmp/minimal-session-bash-tests.log`。模块尚待连接 Tauri Session 工厂与目录句柄生命周期，不能据此宣称桌面 harness 已能调用 Bash；子 harness 的配置/凭据显式传递仍需一起接线。

### Tauri Session Bash 工厂装配

DirectoryMountService.processMounts 从当前 active Session 挂载生成来源目录、虚拟挂载点与 ro/rw 描述，AppKernelPlatform 的进程工厂接收该描述。Tauri main.ts 已注入 createTauriSessionProcesses：内部 admin-home 映射到 MindOS 数据根，外部目录保持显式选择的来源；每个作用域独立打开原生目录句柄。Bash 每次执行先访问 Session 文件视图以检查撤销，再调用 session_shell_exec，原生端由有效目录句柄解析来源并创建 Bubblewrap 命令。Web 仍不配置进程工厂。

作用域关闭禁止新命令，取消并等待活动命令，最后关闭目录句柄；无授权 cwd/非 Linux 隔离不支持时失败，不回退宿主 shell。六项 Tauri 桥接测试、八项 Session 平台/目录测试、Tauri 类型检查及重跑四项 Rust Bash 测试通过。日志 `/tmp/minimal-session-bash-bridge-tests.log`、`/tmp/minimal-session-bash-wiring-tests.log`、`/tmp/minimal-session-bash-wiring-types.log`、`/tmp/minimal-tauri-bash-process-tests.log`。仍缺完整 Tauri Cargo/GUI 证据、子 harness 真实调用，以及显式模型凭据传递；不以桥接替身证明桌面端到端已通过。

### Bash 工具启动真实子 harness

新增 CLI `tests/nested-harness.test.ts`：真实 Runtime ToolService 调用 Bash，测试桥接调用 Tauri 的 Rust Session namespace 与进程执行模块，再启动构建后的 CLI。仓库只读映射到 `/app`，临时工作目录可写映射到 `/workspace`；子 harness 执行两节点 DAG，验证第二节点收到第一节点输出、Run succeeded 与 result.txt 落盘。模型由本地固定 SSE 服务提供，仅注入测试凭证。Linux 测试需要 Node、Rust 与 Bubblewrap；其他平台跳过。

集成测试与 CLI 类型检查通过，日志 `/tmp/minimal-nested-harness-tests.log`、`/tmp/minimal-nested-harness-types.log`。测试已扩展为 LocalFS 外层 Kernel 通过授权 tool.call Effect 调用 Bash；验证外层 Task/Effect succeeded，关闭存储并重新打开后结果与 Effect 记录一致，模型请求仍为两次。该证据覆盖外层 Kernel、真实工具服务、Bash、子 CLI 和子 DAG；未启动 Tauri GUI、未经过真实 Tauri IPC。完整桌面端最小系统仍待这些入口验收，不能把此组合测试称为全链完成。

### 无显示服务器环境的编译与 CLI 验收

当前 `pkg-config --modversion gdk-3.0` 返回 3.24.52；`cargo check --offline`、`cargo build --offline` 与 `pnpm --filter tauri-app build` 均通过。原 GDK 缺失阻塞已解除，历史记录保留。当前证据是 Rust 开发版编译和前端构建，未验证发布安装包或 GUI。日志 `/tmp/minimal-tauri-cargo-check.log`、`/tmp/minimal-tauri-cargo-build.log`、`/tmp/minimal-tauri-frontend.log`。

CLI 全套测试修复前 **49 通过、1 失败**（共 50）：`hitl.test.ts` 的暂停→respond→resume 超时，不能视为整体验收通过。失败时 Flow 等待交互发布的根任务需要调度完成信号，而当时 CLI resume 只恢复 Kernel 并监视根任务，没有恢复调度器。该失败已由下面的交互边界检查点修复；任意崩溃恢复仍待完成。日志 `/tmp/minimal-cli-full.log`。无 X11 可以执行这些 CLI 测试，但它们不能证明 Tauri 窗口、IPC 和交互行为。

### CLI 人工暂停后恢复调度

Flow 在发布人工等待 Run 前保存版本化 scheduler 检查点，包含节点实例、已消费完成事件、边状态、循环派发顺序、动态图与委派组、预算累计和配置快照。`DurableFlowExecutor.resume` 连接已有 Task，恢复这些调度状态并向同一根任务发送完成信号；CLI resume 在监视之前调用该入口。非等待调度的根任务保持普通重连行为。隔离工作区尚无租约恢复接口，因此恢复明确报错。

CLI 人工回应测试现覆盖单节点与带下游节点，验证 Run 根 ID 不变、模型调用次数不重复；完整 CLI **51 项通过**，Flow **124 项通过**，CLI 类型检查通过。日志 `/tmp/resume-cli-full.log`、`/tmp/resume-flow.log`、`/tmp/resume-types.log`。这证明正常人工暂停后关闭并重开的调度延续，不证明任意崩溃点恢复；任务提交与检查点并非原子事务，多恢复者排他、隔离工作区/后台委派计时器恢复仍待完成。

### 独立进程的人工暂停恢复验收

`apps/cli/tests/hitl.test.ts` 新增独立 Node CLI 进程场景：run 以 3 退出后，再启动 respond 与 resume 进程，复用磁盘状态完成下游；连续两次人工暂停还会再启动一对 respond/resume 进程。断言根任务 ID 不变、最终结果落盘、模型调用次数分别为 3 和 4，避免同进程残留调度器掩盖恢复缺口。四项人工恢复测试及 CLI 类型检查通过，日志 `/tmp/hitl-process-tests.log`、`/tmp/hitl-process-types.log`。测试模型仍为本地固定响应服务；退出属于正常暂停，不是 SIGKILL 故障注入。

### 恢复入口及时返回与取消

修复 `DurableFlowExecutor.resume` 等到下游完成或再次人工暂停才返回的问题：恢复状态装配完成后即发布句柄，调度在后台继续，使 CLI 能立即进入任务监视。根任务尚未初始化时，从 input 判断 awaitingSchedule，避免缺少 state 被误认为无需恢复。

新增两项回归，在旧 Kernel 停止后显式接管其租约，阻塞下游模型响应，验证恢复句柄及时返回；随后分别验证正常完成和取消根任务后下游也取消。Flow 全套 **126 项通过**；CLI 四项人工恢复测试及类型检查通过。日志 `/tmp/resume-control-fixed.log`、`/tmp/resume-control-cli.log`、`/tmp/resume-control-types.log`。显式接管仅用于已确认旧 Kernel 停止的测试场景，本批没有增加生产环境的自动强制接管策略，也没有完成多个恢复者的排他保护。

### CLI Run 调度进程互斥

新增 `run-scheduler-lock.ts`：run/resume 在启动运行时之前获取 Run 目录内独立 SQLite 数据库的写锁，持有至运行时清理结束；resume 在读取 manifest 前获取锁。争用者立即报 `Run already has an active scheduler`。锁库与 Kernel 数据库分开，避免长事务阻塞任务数据；不按 PID 或过期时间抢锁，不删除持锁数据库文件。

跨进程测试覆盖持有期间拒绝第二次获取及 resume 入口、正常退出/SIGKILL 后重新获取、同一释放函数重复调用。CLI 全套 **55 项通过**，类型检查通过，日志 `/tmp/scheduler-lock-cli-full.log`、`/tmp/scheduler-lock-types.log`。这为使用同一 Run 目录的本机 CLI run/resume 提供互斥；并未给通用 Flow executor 或多机存储提供 fencing，也不能替代任意崩溃点的调度日志恢复。锁文件应与 Run 数据一同保留，运行时不能由外部程序删除/替换。

### 关闭存储前等待后台调度退出

`DurableFlowExecutor.waitIdle()` 跟踪 submit/resume 启动的后台调度 Promise；CLI dispose 先停止 Kernel，再等待 executor 和 Kernel 的活动工作结束，然后释放工具运行时及存储。外层 run/resume 的调度锁在这之后释放。等待任务结果返回后再次检查 Kernel 是否已关闭，避免在退出过程中继续写人工暂停检查点。

回归验证模型尚未完成时 waitIdle 不提前完成，正常完成/取消后可结束等待；CLI 全套 **55 项**、Flow 全套 **126 项**及类型检查通过，日志 `/tmp/scheduler-drain-cli.log`、`/tmp/scheduler-drain-flow.log`、`/tmp/scheduler-drain-types.log`。该接口等待调度协程退出，不强制终止任意宿主回调，也不提供通用多进程 fencing。

### 删除 Run 与调度清理互斥

CLI delete 现在先取得与 run/resume 相同的调度锁，再读取终态并删除目录。避免 cancel 命令已写 cancelled、旧调度器仍在清理时，删除其存储和锁文件。跨进程测试覆盖终态 manifest 存在但持锁时拒绝删除、文件保持完整、持锁进程正常退出/SIGKILL 后可删除。两组锁测试与九项 CLI 命令测试共 **11 项通过**，CLI 类型检查通过；日志 `/tmp/scheduler-delete-tests.log`、`/tmp/scheduler-delete-types.log`。该保护针对 CLI delete，不约束用户在外部直接删除目录。

### 人工暂停 Run 的最终统计重连

修复 `restoreFlowHandle` 永远读取根任务初始 input.run.usage 的问题。人工暂停发布根任务后，最终汇总将版本化 run metadata 保存到 `flow.run.<rootTaskId>.metadata`，再发送调度完成信号；重连优先读取该记录，没有记录时保持旧 input 回退。已有独立 goal 更新仍优先于 metadata goal。

回归先复现最终 2 token、重连 0 token，以及耗时停留在暂停时；修复后关闭并重建 Kernel，再连接同一根任务，统计与完成时句柄一致。Flow 全套 **126 项**与 CLI 类型检查通过，日志 `/tmp/restored-usage-flow.log`、`/tmp/restored-usage-types.log`。没有对旧版本已完成且缺失最终 metadata 的 Run 做历史统计回填。

### Tauri Session Bash 的失败清理

修复 Session process scope 的 release 在一次取消 IPC 拒绝后跳过后续清理的问题。关闭时冻结活动命令清单，尝试所有取消、等待命令结束、尝试关闭所有目录句柄，再统一抛出 AggregateError。重复/并发 release 复用同一 Promise，不重复发送清理请求。工厂打开后续目录失败时也保留初始化错误及已有句柄的清理错误。

Tauri Bash 桥接 **8 项测试**及 tauri-app 类型检查通过，日志 `/tmp/tauri-cleanup-focused.log`、`/tmp/tauri-cleanup-types.log`；此前 app-shell 全套为 131 通过/30 跳过，随后仅新增初始化清理错误测试并定向验证。新增故障测试使用 IPC 替身，不证明真实 IPC 故障时进程已被杀死；取消失败仍等待原执行请求结束，不把失败取消当作成功终止。

### 原生 Bash 输出内存上限

原生 `bash_process` 不再 read_to_end 无上限积累输出；stdout/stderr 各保留最多 1 MiB 原始字节，超过上限仍继续排空管道并在返回文本中标记截断。UTF-8 无效字节仍使用替换字符，解码后文本大小可能大于原始保留字节数，但有界；工具层自己的最终返回截断保持生效。读取错误现在显式返回失败，不静默冒充完整输出。

六项真实 Rust Bash 测试通过，包括两个流各打印 2 MiB 后正常退出且保留退出码、小输出保持原样、取消和超时；Tauri cargo check --offline 及真实 Bash→子 CLI→DAG 组合测试通过。日志 `/tmp/bash-bounded-tests.log`、`/tmp/bash-bounded-cargo.log`、`/tmp/bash-bounded-nested.log`。此限制约束宿主输出缓存，不限制子进程自身内存、输出速率或磁盘写入。

### 公开最小 DAG 与运行入口

新增 `apps/cli/examples/minimal-dag.yml` 和 `doc/minimal-system.md`，说明无显示服务器下的 CLI 构建、校验、图查看、运行、结果及正常人工暂停恢复。真实 Bash 子 harness 测试改为读取该公开 YAML，仅替换本地测试服务端口；validate/graph 命令和组合测试通过，日志 `/tmp/minimal-example-validate.log`、`/tmp/minimal-example-graph.log`、`/tmp/minimal-example-test.log`。

文档明确 Tauri 授权目录映射、Web 不注入 shell、Session Bash 不继承终端 API key。真实凭证注入及完整桌面操作教程仍待完成，todo P0-03 保持未勾选；没有把命令示意宣称为实际 GUI 验收。

### Bash 子 DAG 的非零退出验收

真实嵌套 harness 测试增加第二节点模型返回 401 的场景。修正测试桥接：子进程数字退出码作为 nativeShell 结果返回，与 Tauri 生产协议一致，不能把 execFile 对非零退出的异常当作真实 IPC 失败。断言子 Run failed、无 result.txt，外层 Task/Effect 保存成功执行 Bash 的结果，其中含 `[exit 1]`，重开外层存储后仍一致。

成功/失败两项组合测试与 CLI 类型检查通过，日志 `/tmp/nested-failure-tests.log`、`/tmp/nested-failure-types.log`。这证明失败状态可供外层 harness 判断，不表示工具 Effect succeeded 等于子 Run succeeded；真实 GUI 如何呈现和决策仍待验收。

### Xvfb 中实际 Tauri 启动

重新核对环境发现 `/usr/bin/Xvfb` 与 xvfb-run 可用。使用独立临时 XDG_CONFIG_HOME、MINDOS_ROOT 和 --home，启动 Vite 与最新 cargo build 的 Tauri 开发二进制；15 秒后应用仍运行，xwininfo 确认 1280×800 的 X1 窗口。通过 X11 截图检查，侧栏、文件列表、开发者工具已渲染且启动遮罩消失；主编辑区为空，未验证聊天/挂载/Bash 交互。测试启动的应用、服务器和虚拟显示均已关闭。

结果 `/tmp/tauri-smoke-result.log`，截图 `/tmp/x1-tauri-smoke-h__876h_/screen.png`，该目录也保存临时配置和 app/vite 日志。日志有 EGL/DRI3 和 renderD128 权限警告，但页面仍渲染。历史“无浏览器/显示环境”不再作为不可推进 GUI 的理由；真实 IPC 子 harness 全链仍未完成，本项只证明实际启动与基础页面渲染。

### 真实 Session Bash IPC 冒烟验证

在 Xvfb 下启动独立临时配置的 Tauri，使用开发者控制台调用真实 `directory_open` 获取临时 home 句柄，映射到 `/workspace`，再调用 `session_shell_exec` 执行 `printf ipc-bash-ok; printf ipc-stderr >&2; exit 7`，finally 调用 directory_close。截图观察到 IPC_RESULT 为 `["ipc-bash-ok","ipc-stderr",7]`，没有 IPC_FAILED；应用仍运行，随后关闭本次所有进程。

证据：`/tmp/tauri-ipc-result.log`、`/tmp/x1-tauri-smoke-t2icu5y3/screen.png`，同目录保存实际控制台命令 `console.js` 与应用日志。该验证是实际 WebView→Tauri IPC→原生 Session Bash，不是 IPC 替身；调用由开发者控制台发起，未经过外层 Kernel/tool.call/聊天 UI，因此 P0-01 仍未完成。截图为手工检查的运行证据，尚未形成仓库自动化 GUI 用例。

### 真实 Tauri IPC 启动子 CLI DAG

在独立临时 Tauri/Xvfb 环境启动本地固定 SSE 模型服务，公开 minimal-dag.yml 写入临时工作目录，仅替换端口。通过真实目录句柄将仓库只读映射 `/app`、工作目录可写映射 `/workspace`，调用 session_shell_exec 启动 CLI 子 harness。宿主断言恰好一个 Run、两次模型请求、第二次含 first-result、最终 result.txt 为 child-result、run.json 状态 succeeded；截图确认真实 NESTED_RESULT 回传。

最初逐字输入控制台异步表达式导致多次执行，不能用于单次调用验收。改为控制台 import 一次性 ES 模块后上述断言通过；模块在测试后移除，应用/服务器/显示进程均关闭。结果 `/tmp/tauri-nested-result.log`，截图及请求/运行记录保存在 `/tmp/x1-tauri-smoke-97bnmj11/`。

本项贯通实际 WebView→IPC→原生 Bash→子 CLI→DAG，仍由测试模块直接调用 IPC，未使用外层 harness 的标准 tool.call 调度入口，P0-01 保持未完成。模型为固定测试服务，不涉及真实凭证。

### CLI/Tauri 共用 Session 文件 Skill 来源

从 Tauri 提取 SessionFileSkillSource 到 kernel-adapters，YAML parser 参数注入，无 Tauri/Node 依赖。原 TauriSkillSource 保留薄封装，CLI runtime 接入相同 skillSourceForSession。新增真实 CLI runtime 测试，通过授权 skill.load Effect 加载临时工作区 Review Skill，并验证正文和持久 loaded 身份。

CLI 全套 **57 项**、kernel-adapters **81 项**、Tauri 来源 **3 项**和两端类型检查通过，日志 `/tmp/shared-skill-cli-full.log`、`/tmp/shared-skill-adapters.log`、`/tmp/shared-tauri-skill.log`、`/tmp/shared-cli-types.log`、`/tmp/shared-skill-types.log`。本项统一文件发现/解析与加载来源，尚未统一 CLI 的新运行 Skill/project 上下文与所有恢复装配；todo 新增 P0-00 跟踪。

## 当前范围裁决

以下结论来自当前设计的明确范围，而非以现有实现重新定义完成标准：

| 项目 | 当前规范及代码证据 | 对本目标的处理 |
| --- | --- | --- |
| Session 文件侧栏 CRUD | [Session 浏览 §1](vfs-session-browser.md#1-目录与交互) 声明投影只读；session-browser.ts 的 mkdir/write/delete/rename 均 EROFS，SessionWorkbench 配置 readOnly；编辑器另经 Session 文件上下文保存 | 不添加会破坏只读投影契约的写入口；挂载边界、合法文件保存及真实 GUI 验收仍保留 |
| 通用文件类型插件路由 | Session 浏览正文明确不在当前实现中，二进制使用安全预览/下载 | 作为扩展边界记录，不把增加新插件系统当作当前规范的必需完成项 |
| 跨 store broker、业务 stream、复杂 TaskGroup、owner 迁移 | [简化核心 §9](durable-harness-core.md#9-运行循环与维护边界) 明确只有实际业务需求才开启；§1/§4 明确排除通用分布式平台等首版扩展 | 保留明确的 unsupported/扩展边界；最小持久消息、基本子任务监管、当前 Flow 委派以及同后端资源一致性仍需完成 |
| 故障与终态不变量 | 简化核心 §9 仍要求六类故障；[协议 §2](durable-harness-protocol.md#2-必须成立的不变量) 要求人工重做创建新 Task、旧终态不可复活及跨进程最终推进 | 保持有效待办，不能因缩小公共 API 或提供记录查看而划为可选 |

这些裁决只纠正审计表误增的功能范围，不删除 Flow 调度恢复、Run retry、Skill 有效接线及六类故障验收要求。历史批次中笼统出现的“CRUD 未完成”等表述，以此表和当前规范为准。

## 文档覆盖

| 文档 | 本次发现与后续核验 |
| --- | --- |
| VFS-design.md | 已全文按 IFileSystem/视图/来源/path-based backend 重写，明确文件与 records 事务差别；vfs-core 167 项通过 |
| vfs-session-fs.md | 历史方案由 C4 决策取代；已修正文首“尚未实现”状态，安全与恢复要求需对照 C4 继续核验 |
| vfs-namespace-refactor.md | 历史方案，已修正状态；独立 namespace/grant/export 及旧布局迁移不再是当前实施要求 |
| vfs-consumer-migration.md | 历史方案，已修正状态；以当前消费端和删除旧入口的证据为准 |
| vfs-c4-review.md | 已核对目录、主要公开 API、CAS/撤销与归档断言；原生 GUI、完整平台生命周期与其余验收仍缺证据 |
| vfs-implementation-status.md | 已有验证记录不能替代本次核验；GUI/Tauri 全机编译、受限进程执行等边界尚未验收 |
| vfs-session-browser.md | 已完成 branch URL/回放、Task 列表/版本/事件分页；当前规范要求只读浏览投影，不将侧栏 CRUD/通用类型插件当作本轮补齐项；真实 GUI 仍缺证据 |
| vfs-session-mount-access.md | 当前挂载交互；平台授权、撤销、重连和执行边界仍需逐项核验 |
| flow-execution-model.md | 已接入静态/动态身份、默认配置/连接作用域、委派模板约束、端口 schema 引用/注册内容校验及失败清理；已有持久 transcript 查询/交换分页/UI/JSON 导出和 Run 记录重连；调度恢复、完整 schema/输出策略、下游重算、transcript 底层分页及平台验收仍未完成 |
| skill-design.md | 已接入 Session 来源、运行前刷新/恢复、L2/L3 上下文、自动匹配、索引预算、持久加载/卸载工具与面板及进程内操作协调；运行中更新、L4 编辑器、初始化工具激活、完整版本冻结及 Skill 自动委派仍未完成 |
| durable-harness-core.md | 窄入口与资源实现需按源码重新核验；当前指向历史 feat 实施记录不足以证明最新接口 |
| durable-harness-protocol.md | 已补当前控制/恢复/等待/分页基线并修复调度参数与长租约定时器边界；最小消息/监管与完整恢复契约仍需逐条核验；复杂 TaskGroup/通用 IPC 扩展按简化核心的明确范围判断 |
| durable-harness-storage.md | 已校正 MindOS 外层/Kernel 内层 Session 路径、IFileSystem 和 managed schema 2；其余 keys、迁移与 GC 要求仍需核验 |
| durable-harness-resources.md | 已核对 managed pool/shared、revoke/destroy/query/physical cleanup 基线并补实际进程清理测试；完整 account/use/跨 authority 目标仍待核验 |
| durable-harness-cache.md | 已补当前 API 基线并修复全部来源授权、模式校验、TTL/generation 溢出；provider/artifact/owner/GC 等目标仍需实施核验 |

当前目录包含原有 15 篇设计与本核验清单，共 16 篇。已检查非代码块内的 93 个本地 Markdown 链接：目标文件存在，目标 Markdown 标题的生成锚点匹配。该检查按标题 slug 规则进行，不是浏览器渲染验收；未验证远程链接、代码块里的示例链接或纯文本路径。完整需求审计仍需逐条对照实现。

以下各节为分批实施记录，测试数字与“仍待完成”描述反映各批当时状态；当前汇总以上表及对应设计正文为准。后续批次已解决的事项不应从历史段落再次判定为未完成。

## 已完成的代码修补

Flow §7.8.3 的动态 graph patch 在发布前整批校验：拒绝重复节点/边 ID、覆盖既有节点、越界依赖、未知插件、非法数据端口和动态新增环。目标限定为本批节点，来源限定为本批、parent 或其直接上游。保留 kind/onFailure、默认 result/input、节点总数上限。相同 key/内容幂等跳过，同键不同内容冲突。校验失败取消剩余运行任务并释放 worktree。

实现：`packages/llm-flow/src/flow/graph-patch.ts` 与 `executor.ts`。执行器新增 12 项回归，覆盖拒绝时不创建子任务、合法 parent/upstream 以及 patch 重放。llm-flow 全套 62 项通过，TypeScript 检查通过；日志 `/tmp/design-flow-test.log`。这不证明 Flow 跨进程恢复：调度集合和 patch 去重当前仍在 executor 内存中，属于后续核验重点。

## VFS 与 Skill 核验补充

VFS 原文的 inode 三层存储、模块权限表、ChatFileHandle 和兼容 API 已被当前目录视图规范取代；正文保留现有 capability 与事务限制，没有将透传文件事务改称原子。重跑 vfs-core 167 项测试、类型检查通过（`/tmp/design-vfs-tests.log`）。Skill 全文核对发现旧 ContextManager 自动路由/压缩链已移除；有效未完成任务保留在 skill-design §8。

Skill 新修补：文件系统定义使用 Session 本地覆盖层，不再修改共享 catalog；loadSkill 检查作用域，cwd 变更撤销旧工具，扫描先关闭旧来源，迟到结果与 dispose fencing；压缩汇总只使用已加载且允许模型调用的技能，glob 和 skill.load effect 遵守 disableModelInvocation。目录边界处理根目录、尾部斜杠、同前缀兄弟目录和缺少 scopeRoot。新增 6 项回归，kernel-adapters 全套 28 项及类型检查通过（`/tmp/design-skill-tests.log`）。

发现的 device-llm SkillManager 旧 `.json` 迁移分支已在下述配置格式核验中移除。

## Skill 指令投递与加载恢复

补齐 load_skill 的实际上下文断点：SkillLoadResult 附本次 instructions/compactInstructions，工具输出包含正文和关键规则，Durable Agent 的既有 tool-result 路径将其带入下一次模型请求。tool.call 按 skillLoaderArgKey 在成功后持久登记 Session 加载 ID，失败不登记；与 skill.load 使用相同恢复记录。新增 adapter runtime 回归验证正文、关键规则、服务重建后的 loaded 状态和已有返回值不随后续 catalog 编辑改变。kernel-adapters 全套 29 项通过，类型检查通过。

这些证据仍不等于完整技能版本冻结或跨进程 Kill 验收。动态新增 tools 的模型列表刷新、四层自动路由和压缩生命周期等保持在有效待办中。

## Durable 资源与存储基线核对

按当前 resource-api/managed-resources/seqfile-core 核对并同步 resources/storage/core：managed 写 schema 2，兼容读取 1/2；当前接口包含 grant revision/epochs、physical cleanup receipt、revoke/destroy/query。MindOS 的 Kernel sessionRoot 是 `/var/lib/sessions/<id>/kernel`，外层 SessionRepository 的 session.seq 与内层 Kernel session.seq 不能混淆。durable-kernel 全套 107 项通过（其中资源 31 项），日志 `/tmp/design-durable-tests.log`。完整 1.1 第 3–4 节 account/use/export/import 等目标没有因此标记完成。

## 长任务逐轮上下文裁剪

修复 DurableAgentProgram 仅初始化裁剪、丢弃 system 指令和截断工具调用组的问题：每次请求模型前裁剪，保留全部 system、最新 user 和完整 assistant/tool 组；阈值可因必要消息超出。模型 Effect 身份改用持久 exchanges 计数，消息数量重复不会复用旧操作。仍是历史裁剪，不是语义摘要；Skill 工具输出中的关键规则持久保留、完整 memory/compaction hooks 仍待接线。

新增 llm-tasks 8 项测试覆盖消息边界、无效策略、五轮裁剪、checkpoint 序列化重放；全套 25 项通过，类型检查通过。新增 Flow 真 Kernel 五轮工具执行测试，验证五个独立成功 Effect 和相同裁剪长度下的不同幂等身份；Flow 全套 63 项通过。日志 `/tmp/design-compaction-tests.log`、`/tmp/design-flow-test.log`。

## Session 分支路由

补齐 vfs-session-browser 的 branch URL 缺口：Session 路由编码独立 branch 参数，文件路径中的问号保持原义；仓库通知后的当前分支变化推入历史，路由回放显式传递 EditorTarget.branch，同 Session 的不同显式分支不再被 no-op 吞掉。普通标题点击仍保持当前视图，离开后默认 main。bootstrap 已接通 push/replace 模式。

新增 7 项测试覆盖 URI 往返、特殊字符、非法 query、文件身份、分支通知、主分支/其他分支回放和无重复打开。app-shell 全套 92 项通过、30 项跳过，Web TypeScript 检查通过；日志 `/tmp/design-browser-tests.log`、`/tmp/design-browser-types.log`。这是自动宿主路由/编辑器目标验证，仍不宣称真实 GUI 人工验收完成。

## Cache 来源与数值边界

按 cache-store/domain/cache 核对并补充当前 API、容量/版本/回执与未实现扩展的基线。修复首个来源命中后跳过后续授权的问题：新读取操作在消费前检查全部来源，refresh/bypass 同样检查；历史 receipt 重放保持不变。新增未知 mode、非法 expectedVersion、TTL 期限和 generation 溢出校验。

新增 6 项回归覆盖四种 mode 下越权来源的原子拒绝、失败后同 operationId 重试、不消耗 single-use、无效输入及溢出时无写入。durable-kernel 全套 113 项与类型检查通过，`git diff --check` 通过；日志 `/tmp/design-durable-tests.log`。跨 Session owner、provider/artifact、retention/GC 和聚合配额仍未据此宣称完成。

## Skill 关键规则跨裁剪恢复

成功 load_skill 的可信 adapter 将当前已加载定义的 compact.rawContent 存入 Effect skillContext；Agent 独立保存按 Skill ID 替换的快照，在每轮模型请求前注入。裁剪工具历史不会删除关键规则，checkpoint 重放也不读取当前 catalog。普通工具伪造 skillContext 会被 adapter 剥除；失败加载不会产生规则。初始化选定 Skill、独立 skill.load、AGENT.md 及动态模型 tools 刷新仍待接线。

llm-tasks 新增四轮裁剪/checkpoint 回归，26 项通过；adapter runtime 验证快照内容及 catalog 编辑后的原结果稳定，并新增伪造字段拒绝测试。kernel-adapters 全套 30 项通过，两个包类型检查通过。

## Skill 动态模型工具刷新

成功加载的 Effect 快照已注册、enabled 的绑定定义和 external 分类；Agent 将声明 allowedToolIds 内的动态定义合并到下一轮模型请求，同名原定义优先。Flow 节点与直接聊天入口传递各自能力范围，后者保留 WebSearch 禁用过滤。快照保存在 Task state，恢复后仍用于模型请求与外部工具审批，不依赖共享 catalog 枚举。执行权限继续由现有工具服务和资源 grant 检查。

新增 adapter 真实服务注册/缺失 binding 过滤测试，以及 Agent 声明范围/同名优先/恢复后 external 审批测试。llm-tasks 27 项、kernel-adapters 31 项通过，两个包类型检查通过；Session 全套 50 项、Flow 全套 63 项回归通过，两者类型检查通过；日志 `/tmp/design-session-tests.log`、`/tmp/design-flow-test.log`。四层自动路由、初始化技能激活与完整版本冻结尚未因此完成。

## Flow 初始化 Skill 上下文

FlowNodeBinder 补齐从正文分离出来的 compact.rawContent，作为独立 system 消息进入持久 Task input；同时在模型边界过滤 disabled/disableModelInvocation 技能及其自动合并工具。保持 systemPromptPolicy=none 的显式无系统提示语义。新增回归验证正文/关键规则、静默/禁用过滤、定义后续编辑不改变已绑定消息，以及 none 策略。llm-session 51 项测试及类型检查通过；日志 `/tmp/design-session-tests.log`。初始化动态工具激活、直接聊天 Skill 上下文和目录来源授权仍待接线。

## C4 Skill 配置格式

核对启动批量加载、SkillManager reload/save/delete 和 VFSHelpers：统一 Skill canonical `.yaml`，移除保存时探测/删除同名旧 JSON、删除时 JSON fallback，以及加载旧 JSON/YML 的路径。其他配置集合的原生 JSON 接口继续使用。新增生命周期回归证明旧文件不被读取/删除、删除 YAML 后不从旧配置复活，其他集合仍能读 JSON。device-llm 全套 46 项测试、类型检查通过，日志 `/tmp/design-device-llm-tests.log`。C4 与 Skill 设计已同步。

## Task 版本存储分页

新增 Kernel/SeqFileStore.taskHistoryPage：按固定版本键直接批量 getEntries，默认 100、上限 500 个键，首批固定 throughVersion，后续返回 nextAfterVersion；不扫描/解码全部历史。SessionWorkbench 详情接入“加载更多版本”，阻止重复请求并丢弃迟到结果。事件、Task 列表和浏览文件导出仍全量读取，未将版本分页冒充完整历史分页。

Kernel 回归验证单键读取、不调用 walkEntries、分页期间新增版本不混入原快照及非法范围拒绝；jsdom 验证真实 workbench 加载更多、上界传递、重复点击与最后一页隐藏按钮。durable-kernel 114 项、app-shell 92 项通过（另 30 项跳过），Kernel/Web 类型检查通过。日志 `/tmp/design-durable-tests.log`、`/tmp/design-browser-tests.log`、`/tmp/design-browser-types.log`。

## Task 事件索引分页

事件写入同事务维护 Task 内序号及指向 Session 事件的索引，新增 Kernel.taskEventPage，固定 throughIndex 并按 limit 有界读取引用/事件。缺失索引的旧日志首次查询原子补建一次；此后不扫描其他 Task 事件，错误跨 Task/Session 引用拒绝。SessionWorkbench 改用该 API，版本与事件有独立加载按钮、上界与防重复点击保护。Task 列表及浏览文件导出仍全量。

新增 Kernel 索引分页、稳定上界、无扫描、旧日志补建和跨 Task 指针拒绝回归；jsdom 验证事件按钮、游标与不调用全 Session eventList。durable-kernel 116 项、app-shell 92 项通过（30 项跳过），Kernel/Web 类型检查通过。日志 `/tmp/design-durable-tests.log`、`/tmp/design-browser-tests.log`、`/tmp/design-browser-types.log`。

## Task 列表分页与侧栏预览

新增稳定 Task 成员序号及 listSessionTaskPage，固定成员上界并按页读取当前状态，旧索引首次查询补建。主视图提供“加载更多任务”；侧栏只读首批，有后续时显示 @more 分页入口，避免侧栏再次全量加载。真实 UI 回归暴露 selectPath 展开祖先的中间通知会排队重开聊天，现同步选择期间忽略这些回写。

Kernel 测试覆盖后续新增排除、状态更新不换位、旧索引补建和非法分页；浏览投影验证首批/更多入口及不调用全量列表，jsdom 覆盖加载、游标、连续导航。durable-kernel 117 项、app-shell 93 项通过（另 30 项跳过），Kernel/Web 类型检查通过。日志沿用本轮 design-durable/browser 文件。

## Durable 控制与恢复基线

protocol 补充实际 TaskStatus/Control、默认无周期轮询、deadline timer、显式 takeover 的宿主前提，以及等待/分页的实际范围。未将目标 paused/finalizing/Endpoint 等字段写成当前 API。核验发现构造参数允许 NaN/Infinity 租约/轮询，以及长租约心跳超过平台定时器上限；现拒绝非法参数并夹紧心跳间隔。

新增 8 组无效配置测试及真实 Kernel 长租约执行测试，验证 setInterval 参数不溢出。durable-kernel 126 项和类型检查通过；日志 `/tmp/design-durable-tests.log`。全套跨进程 kill、时钟来源、恢复扫描分页和目标 1.1 验收仍未完成。

## LocalFS 独立进程与 SIGKILL 验收

复跑既有 16 项独立 OS 进程/SQLite 测试，确认等待唤醒、竞争 claim、多文件事务中 kill 回滚、强制 takeover、物理清理和 rename 恢复。新增两个挂载模式下的 8 项场景：single-use 两进程竞争、receipt 提交前/后 SIGKILL、失效后原 receipt 重放与分页索引重开，以及带 maxAttempts=2 的自然租约到期恢复。自然到期遵守重试预算，不能把默认一次尝试的失败误认为恢复调度未发生。

24 项均通过。这些场景证明已登记 lease 的无周期轮询到期推进，不覆盖完全空闲进程的远端新提交通知，也不代替完整 §15 故障矩阵。日志 `/tmp/design-kernel-ipc-tests.log`；protocol/cache 已补实际证据与部署边界。

## Flow 数据端口 schema 引用

核对发现端口 schema 类型是 id/version 引用。新增统一 dataEdgeSchemaIssue，目标有 schema 时要求来源相同引用；发布校验、直接 submit 与动态 patch 接入，直接执行在打开 Session 前拒绝，control edge 跳过。结构内容注册表、结构兼容推导及 responseFormat 自动绑定没有据此标记完成。

新增 10 项测试覆盖相同/不同 ID、版本、缺失声明、未约束目标、control edge，以及发布/执行/patch 三个边界；llm-flow 全套 73 项、类型检查及差异检查通过，日志 `/tmp/design-flow-test.log`。

## Skill 参考文件、模板与修正日志

loadSkill 通过 runtime 注入的 Session readFile 读取明确声明的 reference/template/enabled correction-log，激活前校验全部相对路径与虚拟根，限制 20 文件、单个 64 KiB/合计 256 KiB。没有能力、读取失败、超限或作用域在 IO 期间变更均不激活；内容附入持久工具输出，不调用宿主原生文件 API。Tauri 解析器保存修正日志及项目根，嵌套作用域不改变该根。前端入口、宿主来源到虚拟挂载映射以及这些普通支持指令的长期裁剪策略仍按文档边界保留。

kernel-adapters 新增 6 项回归，37 项通过，adapter/Tauri 类型检查通过；另增加 Tauri 解析测试。日志 `/tmp/design-skill-tests.log`、`/tmp/design-source-tests.log`、`/tmp/design-tauri-types.log`。

## Skill 支持文件配置表单

SkillSettingsEditor 新增虚拟根、逐行参考路径、模板、修正日志项目根和独立开关。修复修正日志对象显示为 `[object Object]`、保存时强制启用，以及 YAML 自动保存清空 tools/triggerPatterns 和丢失其他未显示字段的问题；渲染保留定义快照，两条保存路径共用支持文件字段解析。中英文提示明确路径来自已挂载的 Session；当前提供文本配置，没有文件浏览器或自动挂载。

新增 DOM 集成测试覆盖特殊字符显示、修改路径、禁用状态、手动保存和 YAML 自动保存、非表单元数据保留以及清除修正日志。1 项通过，llm-settings-ui 类型检查和差异检查通过；日志 `/tmp/design-skill-settings-tests.log`、`/tmp/design-settings-types.log`。宿主来源到 Session 虚拟路径映射仍未完成。

## 直接聊天初始化 Skill 上下文

本批补齐直接聊天初始化的配置 Skill 上下文：通过 AgentResolver 按 capabilityPolicy.skillIds 解析，仅注入选中且允许模型调用的启用定义。正文和关键规则进入 ContextAssembler 的 skill/system 块及实际持久 Task input；空选择不读 catalog，读取失败不提交 Task。初始化工具激活、Session 目录来源、独立 skill.load 消费及 AGENT.md 仍未完成。

新增测试使用真实 Kernel/MemoryBackend 提交并读取 Task，验证极小预算仍保留 system 指令、定义后续编辑不改变已保存输入、静默/禁用/未选中定义过滤、空选择与 catalog 失败行为；只替换 Round UI 投影和结果消费。llm-session 全套 52 项与类型检查通过，日志 `/tmp/design-direct-skills-tests.log`、`/tmp/design-direct-skills-types.log`。

## Tauri Session 技能来源

本批 Tauri 移除固定 homeDir/原生 TauriFsOps 技能扫描。新增 skillSourceForSession 装配接口，获取 Session 文件能力后为该虚拟 cwd 创建来源并完成扫描；支持文件和 SKILL.md 使用同一视图。沿用挂载变化 disposeSession 的重建机制，切到项目根外清空定义；缺失文件按空，授权错误传播并释放已获取视图。项目根取创建时的已配置 cwd，没有自动项目根发现、文件内容 watch 或 Web/CLI 来源装配。

3 项来源测试通过，其中真实 VFS/运行时集成覆盖两个 Session 同路径不同内容、引用读取、视图替换重建和作用域移出；额外验证 ENOENT/EACCES 区别。kernel-adapters 全套 38 项通过，新增初始化失败释放测试；adapter 和 Tauri 类型检查、差异检查通过。日志 `/tmp/design-session-source-tests.log`、`/tmp/design-source-adapters-tests.log`、`/tmp/design-scope-types.log`、`/tmp/design-scope-tauri-types.log`。这不是原生 GUI 挂载操作的验收证据。

## 项目 AGENT.md 上下文

app-shell 从 Session SkillService 提供 resolveProjectInstructions，贯穿会话系统/管理器/协调器，ContextAssembler 记录 project/system 来源块。直接聊天将其写入持久 Task；聊天内 Flow 重建节点系统消息时保留该来源，显式 none 策略不注入。沿用 system 块预算和逐轮裁剪保护；没有把独立 DAG 命令入口或文件内容 watch 标记完成。

扩展真实 Session 来源测试验证隔离的项目规则和视图替换，扩展真实 Kernel 提交测试验证极小预算下的项目规则输入，并扩展 Flow 绑定/none 测试。Session 52 项、llm-tasks 27 项、来源 3 项通过；Session、Tasks、Tauri 类型检查通过。日志 `/tmp/design-project-context-tests.log`、`/tmp/design-project-tasks-tests.log`、`/tmp/design-project-source-tests.log`、`/tmp/design-project-types.log`、`/tmp/design-project-session-types.log`、`/tmp/design-project-task-types.log`。

## Flow 运行失败清理

核对恢复前置状态时发现 executor 只在 graph effect 校验异常中释放 workspace，其他调度失败遗漏清理。将 workspace 获取后的整个调度/聚合阶段纳入统一异常处理，尝试取消已提交未完成实例并 finish(failed)，清理异常与原失败合并保留。初始 maxNodes 检查前移至任何 Session/hook/workspace 动作前。正常运行的异步 workspace 收尾改为只调用一次，并通过句柄 workspaceCompletion 提供结果，避免清理失败再次清理和未处理 rejection。

新增 4 项测试覆盖超限无副作用、已提交节点后 hook 失败取消/释放、清理双重失败保留原因、成功根 Task 后 cleanup 失败的可观察且只执行一次语义。llm-flow 全套 77 项及类型检查、差异检查通过，日志 `/tmp/design-flow-cleanup-tests.log`、`/tmp/design-flow-cleanup-types.log`。内存中的 route/loop/delegation/预算仍未实现持久恢复；取消失败确认、工作目录崩溃回收及清理错误 UI 仍未据此完成。

## C4 要求与证据核对

本批重新读取 vfs-c4-review §1、§5–10 的目录、公开接口和生命周期条款，并检查对应源码/测试断言。下表区分已核对的范围与仍缺的验收，不将绿灯测试扩大为整机证明。

| C4 条款 | 当前证据 | 判断与未覆盖范围 |
| --- | --- | --- |
| §1 系统与 Session 目录 | bootstrap 的 /run MemoryBackend、admin 目录；SessionRepository 的 session.seq/history.seq/attachments；session-storage-layout 的 kernel 路径 | 目录声明与实现一致；不是备份恢复全量验收 |
| §5 精确路径与权限 | vfs-core 20-file-system-view 的同名路径、ro metadata、assets/records、搜索、路径逃逸、在途 IO/撤销测试；SessionFiles 集成 | 已核对测试断言并重跑；OS 进程隔离仍不属于这些测试 |
| §6 打开/关闭会话 | SessionWorkbench DOM 路由、映射编辑与 branch 回放测试；bootstrap 的 Session resolver | app-shell 测试通过；原生 GUI 打开/关闭及全局生命周期仍需独立验收 |
| §7 CAS 与 draining | SessionFiles configure/disable 写 draining、排空视图、发布；测试固定 revision/中断后明确恢复 | 单宿主实现与文档一致；新增拒绝非法及 MAX_SAFE_INTEGER revision，防止溢出损坏。未证明多进程挂载写入协调 |
| §8 公共接口 | IFileSystem/FileSystemContext 与 IEditor.EditorTarget 源码、SessionRepository 方法 | 所列签名一致；namespaceId 仍是 EditorTarget 的可选字段，不能把它误判为已删除的独立 namespace 子系统 |
| §9 删除与平台装配 | vfs-core/src 检索无 IModuleFS/ModuleFS/FSModuleStats/ENOMODULE/BaseModuleService/registerModule；Tauri 类型检查 | 删除声明在该源码范围成立；不是所有包全量符号审计，GUI/Cargo gate 仍未完成 |
| §10 撤销与边界 | SessionFiles 现改用真实 history.seq，验证内容/records 访问均拒绝；派生 Session 附件撤销测试 | 存储隔离测试有效；原 conversation/manifest.json 样例已替换 |
| §10 归档与清理 | 22-archive-lifecycle 二进制、metadata、refs、seq counter 往返，坏归档预验证，启动失败和并发关闭测试 | 已检查断言并重跑；跨来源故障中途 restore、全系统快照及原生 GUI 清理仍未据此验收 |

本批 vfs-core 167 项、app-shell 全套 97 项（30 跳过）通过；revision 修补后 SessionFiles 定向 6 项通过，Tauri 类型检查通过。日志 `/tmp/design-c4-vfs-tests.log`、`/tmp/design-c4-app-tests.log`、`/tmp/design-c4-boundary-tests.log`、`/tmp/design-c4-types.log`。vfs-implementation-status 过期测试数和“Task 尚未分页”已同步；总体目标尚未完成。

## 新会话运行前 Skill 刷新

refreshScopedSkills 现在保留同 cwd 下先前显式加载文件技能的重载意图，扫描后重新读取支持文件、检查启用/模型调用状态并替换动态工具；定义缺失或禁用则不再激活。unload 清除意图，激活 revision 防止迟到读取重新安装；切换 cwd/关闭服务清除意图。app-shell 项目上下文 resolver 在每次新运行前刷新，失败在提交 Task 前报告。运行中 watch、glob 关联恢复及 L3 正文自动注入仍未完成，现有 Task 指令快照不改写。

新增 3 项 adapter 回归覆盖新旧工具替换、显式卸载/目录切换、支持文件失败与禁用、异步卸载竞态；扩展真实 VFS 来源测试覆盖参考文件与 AGENT.md 编辑刷新、加载状态和原结果保持。kernel-adapters 41 项、来源 3 项通过；adapter/Tauri 类型检查通过。日志 `/tmp/design-skill-refresh-tests.log`、`/tmp/design-refresh-source-tests.log`、`/tmp/design-refresh-adapter-types.log`、`/tmp/design-refresh-types.log`。

## 新运行的 Skill 路由上下文

新增 buildSkillPromptContext，在 Session 来源刷新后将 L2 未加载技能投影为 id/name/description JSON 索引，将 L3/L4 已加载正文、支持文件及关键规则合成提示，排除 silent/disabled。resolveSessionContext 替代上一批单一项目规则回调，ContextAssembler 分别保存 project/session-skill/skill-index 系统来源，直接聊天与聊天内 Flow 消费；none 策略跳过，工具白名单不变。自动语义匹配、运行中更新、独立索引预算、L4 编辑器事件和重启后的加载身份上下文恢复仍未完成。

新增 2 项 adapter 测试证明未加载正文不进入索引、支持文件及关键规则完整、静默/禁用过滤及 IO 失败拒绝；扩展真实 Kernel 输入和 Flow/none 测试验证来源传递。kernel-adapters 43 项、llm-session 52 项、llm-tasks 27 项通过，adapter/Tauri 类型检查通过。日志 `/tmp/design-route-adapters-tests.log`、`/tmp/design-route-session-tests.log`、`/tmp/design-route-tasks-tests.log`、`/tmp/design-route-adapter-types.log`、`/tmp/design-route-types.log`。

## Skill 提示词组装前恢复

SessionCapabilityRegistry 新增 restore(sessionId, loadedSkillIds)，与 getForContext 共用恢复逻辑。宿主在 resolveSessionContext 中读取实际 Kernel Session shared，再恢复来源当前定义，解决首个 Effect 才加载、提示词构建过早的问题。活动作用域只恢复一次，并发过程合并，销毁/替换后的旧恢复不能标记新作用域为已恢复。损坏身份记录和当前 model-disabled 定义拒绝，其他加载检查沿用服务。

新增 3 项测试验证持久状态接口保存后重建 scope、先恢复后构建正文、活动 scope 的 unload 保留、损坏/静默拒绝，以及并发恢复与销毁竞态。kernel-adapters 46 项及 adapter/Tauri 类型检查、差异检查通过，日志 `/tmp/design-prompt-restore-tests.log`、`/tmp/design-prompt-restore-types.log`、`/tmp/design-restore-types.log`。本批测试使用状态接口假件与真实运行时，未新增 OS 进程重启测试；完整版本冻结及 unload 删除持久 loaded ID 仍未实现。

## 新运行自动 Skill 匹配

当前用户消息贯穿 resolveSessionContext 到 buildSkillPromptContext，刷新后按 priority/id 加载 autoLoad 或启发式匹配的 reference 候选，过滤 disabled/silent/action。成功加载经统一 rememberLoadedSkill CAS 合并持久 ID；保存失败撤销本次自动加载并停止提交，已成功保存的前序候选保持有效。修复非法正则导致全轮抛错，以及重复描述词被误算为两个匹配词。工具白名单仍按原调用链控制。

新增自动选择/优先级/静默与 action 过滤/非法正则/重复词、保存失败卸载测试；新增真实 Kernel shared 并发合并及重复加载幂等测试。kernel-adapters 49 项、Session 52 项及 Tauri 类型检查通过，日志 `/tmp/design-auto-skills-tests.log`、`/tmp/design-auto-session-tests.log`、`/tmp/design-auto-skills-types.log`。这是运行前自动匹配，不是 embedding 检索、运行中 watcher 或 L4 编辑器生命周期接线。

## Skill 索引预算

L2 索引使用默认 8192 UTF-8 字节上限，完整计入提示头/JSON，按 priority/id 保留完整元数据条目、报告 omitted，不截断 ID/JSON。可用 indexByteLimit 调整或设为 0，非法数值在读取/加载前拒绝。ContextAssembler 在总预算不足时先丢弃 skill-index，随后才处理历史，规则系统块保留；ContextExplanation 将索引标为 optional/priority 30。进入 Task 后的逐轮 system 裁剪语义未改，不宣称精确 token 上限。

新增 2 项索引测试覆盖中文 UTF-8、超大条目、优先级/稳定顺序、默认上限、禁用/非法值；新增 ContextAssembler 测试覆盖先丢索引保留历史与规则，更新真实 Kernel 小预算输入断言。kernel-adapters 51 项、llm-tasks 28 项、Session 52 项、Tauri/Tasks 类型检查通过，日志 `/tmp/design-index-adapters-tests.log`、`/tmp/design-index-tasks-tests.log`、`/tmp/design-index-session-tests.log`、`/tmp/design-index-types.log`、`/tmp/design-index-task-types.log`。

## Skill 持久卸载 Effect

新增并注册 skill.unload@1，要求 skill execute grant/Session shared state，先通过同一 CAS 身份更新器删除 ID，再清理活动 scope。它不调用加载恢复，允许清理已删除/静默定义的历史身份。写入失败不卸载，本地清理失败可重试且不重复写 shared revision；重建 scope 不恢复已移除 ID。低层 unloadSkill 仍是内存操作，UI/Agent 工具入口仍未装配；没有删除既有 Task 指令或禁止未来自动匹配。

新增 3 项测试覆盖持久卸载/作用域重建和缺失定义清理、无 grant/无状态/存储失败拒绝，以及删除后清理中断的幂等重试。kernel-adapters 54 项与类型检查、差异检查通过；日志 `/tmp/design-skill-unload-tests.log`、`/tmp/design-skill-unload-types.log`。

## 跨文档状态与链接复核

检查当前 16 篇 Markdown 的非代码块本地链接，90 个文件目标和标题锚点全部匹配。更新首页覆盖表与后续任务，区分当前状态和分批历史，避免已完成的上下文、索引、来源/恢复、卸载 Effect、分页及 schema 引用工作重复出现在有效待办中。没有将远程链接或 GUI 渲染标记已验收。

当前 app-shell 全套 98 项通过、30 项跳过；日志 `/tmp/design-current-app-tests.log`。实现状态文档同步最近验证数，跳过测试不计入通过。整体需求仍未全部完成。

## 独立 DAG Session 上下文

DagCommandService.RunStart 在编译/Composite 展开后调用宿主 resolveSessionContext，把项目规则、已加载技能和索引快照传给 Agent 节点；独立运行没有用户消息，resolver 接收空字符串。会话系统将现有回调传入独立 DAG 命令服务。修复 builtin.agent 默认消息忽略 systemPrompt，并使无 binder 的配置合并遵守 inherit/replace/none；工具白名单不变。预组装 messages 仍是基本消息来源，none 去除其中系统消息。

新增 3 项命令注册到真实 Kernel 的回归，读取持久 Agent input 验证三个策略、Session context 及空工具范围。Flow 全套 80 项及 Flow/Tauri 类型检查通过，日志 `/tmp/design-dag-context-tests.log`、`/tmp/design-dag-context-types.log`、`/tmp/design-dag-context-app-types.log`。独立身份引用解析、运行中动态新节点继承及完整 Flow 恢复仍未据此完成。

## 动态 Flow 节点上下文

将独立 DAG 的 Session 上下文从静态编译后节点修改移到 executor.submit 的运行快照及每个 Agent 实例创建点，覆盖 patch/委派新增节点。聊天内 Flow 从 ContextSnapshot 的 project/session-skill/skill-index 来源传递同一选定上下文；builtin.agent 只对新增上下文与既有相同系统消息去重，none 继续不注入。冻结文本与权限分离，节点 capabilities 不继承扩大。

新增 3 项真实 Kernel 测试覆盖动态 patch 的 inherit/none、运行中修改原对象不改变快照，以及已绑定系统消息不重复；扩展委派测试检查子任务持久输入。Flow 83 项、Session 52 项及 Tauri 类型检查通过；日志 `/tmp/design-dynamic-context-tests.log`、`/tmp/design-dynamic-session-tests.log`、`/tmp/design-dynamic-app-types.log`。运行恢复和独立身份引用解析仍未完成。

## 独立 DAG 身份绑定

DagCommandService 增加宿主 bindNode 回调，在 flowToDag/Composite 编译中调用。会话系统装配 bindStandaloneFlowNode，复用既有 AgentResolver、提示库/Skill 规则、模型优先级、工具声明和递归委派模板解析。独立模式使用节点输入或已有 messages，不引入聊天 history/虚假 Round 存储；非 Agent 节点输入不改写。运行中 patch 新声明的引用和完整版本冻结仍未实现，缺失引用沿用既有日志/回退语义。

新增 3 项独立身份绑定测试覆盖 inherit/replace/none、Agent/提示库/Skill 合并和模型覆盖；新增命令到真实 Kernel 的测试验证宿主绑定结果写入 Task input。Session 55 项、Flow 84 项及 Tauri 类型检查通过；日志 `/tmp/design-identity-session-tests.log`、`/tmp/design-identity-flow-tests.log`、`/tmp/design-identity-types.log`。

## 动态 patch 身份绑定

执行器新增宿主 bindPatchNode 回调，独立 DAG 命令与聊天内 Flow 分别复用各自身份绑定器。原始 patch 通过整批结构及数量校验后，顺序等待所有节点解析，再复验并发布；幂等记录仍以原始 patch 为依据，只在发布成功后更新。传入绑定器的是节点副本，发布时只采用 config/inputs，保留原能力和预算；config.toolIds 限定为原 capabilities，delegation 保留原声明，避免引用身份扩大动态节点授权。动态节点尚不继承 Flow 默认身份层，其委派模板身份解析仍待完善；引用不存在仍沿用绑定器原回退语义。

新增 2 项真实 Kernel 测试覆盖异步身份写入持久 Task input、绑定器修改副本/返回额外工具与委派不扩权，以及后一节点解析抛错时整批均未提交。Flow 86 项、Session 55 项、Flow 与 Tauri 类型检查通过；日志 `/tmp/design-patch-flow-tests.log`、`/tmp/design-patch-session-tests.log`、`/tmp/design-patch-flow-types.log`、`/tmp/design-patch-types.log`。

## 动态委派模板身份

动态 patch 不再整体丢弃宿主解析的委派模板：patchIdentityConfig 保留 resolvedTemplate 的身份内容，递归恢复各级原 capabilities/toolIds 和委派调度策略；未声明能力默认空集，身份解析不能安装新增 delegation 或旧 subtasks。原始模板已有 resolvedTemplate 时仍按运行时优先级使用它作为权限依据。该限制仅应用动态 patch，静态 Flow 的既有绑定语义不变。

新增真实 Kernel 动态委派测试，验证子任务持久输入中的模型/规则、空工具授权与原 fanout 数量；新增递归模板测试验证两级权限与规则、禁止身份注入旧委派。Flow 88 项与 Tauri 类型检查通过，日志 `/tmp/design-patch-template-tests.log`、`/tmp/design-patch-template-types.log`。完整版本冻结、动态节点 Flow 默认身份层和持久调度恢复仍未完成。

## 动态节点默认身份作用域

DagRunSpec 增加编译器生成的 nodeDefaults，flowToDag 为所有节点保留所属 Flow 的默认身份层，Composite 展开时按新节点 ID 映射子 Flow 的默认值并替换子 Flow 参数。执行器提交时复制并应用运行参数，patch/委派新增节点沿产生节点继承作用域；宿主绑定器接收这份默认配置，无绑定器时也合并系统提示并遵守 inherit/none。该配置不进入动态节点能力授权，仍保留原声明。运行中编译原对象或绑定器修改其副本不会修改运行默认值。

新增 2 项真实 Kernel Composite 动态节点测试，覆盖子 Flow 规则而非外层规则、none 策略、运行中修改原 defaults、空工具权限。Flow 90 项、Session 55 项、Flow 与 Tauri 类型检查通过；日志 `/tmp/design-patch-defaults-tests.log`、`/tmp/design-patch-defaults-session-tests.log`、`/tmp/design-patch-defaults-flow-types.log`、`/tmp/design-patch-defaults-types.log`。这不代表完整身份版本冻结或调度恢复完成。

## 动态节点连接解析

补齐静态与动态节点连接选择的差异：编译器保留按节点划分的 nodeConnections，Composite 展开映射子 Flow 作用域；执行器提交时冻结连接表，动态 patch 绑定身份后和委派子节点生成后，在提交 Task 前调用同一个 resolveNodeConnection。后代继续继承产生节点的连接表，避免 Composite 的同名槽位错误使用外层连接。

将 Composite 默认身份测试扩展为 6 种策略/连接组合，覆盖默认槽位、显式别名、全局 ID 透传和子 Flow 同名隔离；扩展动态委派测试验证持久子任务输入中的全局连接 ID。Flow 94 项、Flow 与 Tauri 类型检查通过，日志 `/tmp/design-dynamic-connections-tests.log`、`/tmp/design-dynamic-connections-flow-types.log`、`/tmp/design-dynamic-connections-types.log`。未宣称网络模型调用或完整平台端到端验收。

## 持久任务 Transcript 查询

根聚合任务新增 runTasks 清单，记录全部实例的 nodeId/taskId/iteration/detached，包括不参与结果汇总的节点。新增 dag.run.transcript 与 readFlowTaskTranscript，以持久清单校验归属，从 Task Effect/interaction 记录返回完整交换，不依赖原运行句柄或已压缩消息窗口。同时为 RunSignal 的显式目标补齐当前 Run taskIds 校验。

扩展真实 Kernel 五轮压缩测试：dispose 并重建 Kernel/命令服务后仍读到五次模型交换与最早工具调用；新增循环旧实例/未汇总节点查询及跨 Run 拒绝测试、新增跨 Run signal 拒绝测试。Flow 96 项、Flow 与 Tauri 类型检查通过；日志 `/tmp/design-transcript-tests.log`、`/tmp/design-transcript-flow-types.log`、`/tmp/design-transcript-types.log`。该证据是同存储上的 Kernel 重建，不是 OS 进程重启；当前是整任务结构化 transcript，无分页/专用 UI/导出，根尚未生成的运行亦未覆盖，不代表持久调度恢复完成。

## Transcript 展示与导出

DagWorkbench 的任务列表增加任务记录入口，使用独立 dialog 请求 dag.run.transcript；按输入、持久 Effect 交换、交互审批、输出分段显示，支持导出完整 JSON 快照。所有内容通过 textContent 写入，导出文件名归一化，Blob URL 使用后释放；面板轮询不会替换 dialog，关闭后迟到的结果不再更新界面。新增中英文文案。

新增 2 项 DOM 集成测试，验证注入样式文本不产生元素、交换文本存在、命令参数、JSON Blob 与文件名、URL 释放和关闭后迟到结果忽略。app-shell 100 项通过、30 项跳过，Tauri 类型检查通过；日志 `/tmp/design-transcript-ui-tests.log`、`/tmp/design-transcript-ui-types.log`。测试用 showModal 替身补足 jsdom，不声称真实浏览器/Tauri 文件下载验收；分页、纯文本文件导出和运行恢复仍未完成。

## Transcript 交换分页

查询增加 version/offset/limit，默认 100、上限 500 条 Effect，按 Effect ID 稳定排序，返回 totalEffects/nextOffset；后续页必须指定版本。复用 Kernel 的精确历史版本读取，已完成任务当前记录与所选早期版本不混合。UI 增加加载更多，连续页合并后显示，未读完时禁用完整 JSON 导出；加载失败可重试同一页。

扩展真实 Kernel 压缩测试，逐页读取早期版本并与该快照的 Effect 集合逐项对比，确认当前最终响应不混入；新增 4 项非法 limit 测试和 1 项 DOM 翻页/完整导出门控测试。Flow 100 项、app-shell 101 项通过/30 项跳过、Flow 与 Tauri 类型检查通过，日志 `/tmp/design-transcript-page-flow-tests.log`、`/tmp/design-transcript-page-ui-tests.log`、`/tmp/design-transcript-page-flow-types.log`、`/tmp/design-transcript-page-types.log`。当前是返回交换数量分页，底层完整 Task 快照/Effect 集合读取、输入/输出/interaction 与单交换字节大小未有界，不能据此认定存储或内存分页完成。

## Run 记录重新连接

根聚合任务增加 v1 goal/usage 元数据，RunGet 接受 sessionId，在当前服务没有句柄时从持久根和实例清单重建记录句柄，恢复 latest node、全部任务、循环计数和 detached 标记；attachedFromStorage=true 表示未恢复调度。目标更新增加 shared 条件写入，重建时读取最新目标。任务树改为读取清单内任务，避免遍历无关 Session 任务。DagWorkbench.openRun 增加可选 Session ID，刷新沿用已知 Session。

新增真实 Kernel 重建测试，验证循环实例、最新节点、清单、usage、更新目标和 Session 不匹配拒绝。Flow 101 项、Tauri 类型检查通过；日志 `/tmp/design-run-reattach-tests.log`、`/tmp/design-run-reattach-types.log`。这不是 OS 进程崩溃验收；未生成根任务、无 v1 元数据、调度继续执行和 workspace 收尾未覆盖，目标保存与 suspend/resume 也非单事务，不能标记持久调度恢复完成。

## 当前状态汇总复核

重新扫描 16 篇设计的当前状态入口，更新审计首页与 VFS 验证汇总中已过期的 Flow/Session/app-shell 数量和 transcript 结论；保留历史批次记录原证据，不把后续实现倒填为早期批次完成。重新执行本地链接检查：16 篇文档、90 个非代码块本地内联 Markdown 链接，目标及标题锚点均匹配；脚本 `/tmp/design-link-audit.py`。仍不等于远程链接、渲染图或逐项需求验收。

发现已连接 RunGet 缓存目标而忽略另一个服务实例写入的 shared 目标；改为每次查询优先读取持久目标，扩展重连测试验证两个服务实例之间的更新可见。Flow 101 项及 Tauri 类型检查通过，日志 `/tmp/design-goal-authority-tests.log`、`/tmp/design-goal-authority-types.log`。未引入多宿主调度所有权协议。

## Skill 委派子模型

Tauri SKILL.md 解析器保存 subagent.model 到 SkillDefinition.subagentModel；会话 Flow 绑定器在递归委派子模板绑定时消费显式选择的有效 Skill 模型。子节点显式模型与引用 Agent 模型优先于 Skill，Skill 优先于 Flow/Session 默认；不影响父节点，也不使用仅由外层继承的 Skill 子模型。冲突且未显式选择模型时拒绝，避免依赖 catalog 返回顺序。仍不自动从 load_skill 发起子任务，subagent.role 自动提示组装与完整 TaskGroup 编译仍未完成。

新增 3 项 Session 绑定测试覆盖父子模型隔离、显式覆盖及模型冲突；扩展 Tauri 来源测试验证解析字段。Session 58 项、app-shell 101 项通过/30 项跳过、来源定向 3 项及 Tauri 类型检查通过，日志 `/tmp/design-skill-subagent-tests.log`、`/tmp/design-skill-subagent-app-tests.log`、`/tmp/design-skill-subagent-source-tests.log`、`/tmp/design-skill-subagent-types.log`。这些测试尚不是自动委派或真实模型网络调用验收。

## 委派上下文工具交换完整性

核对 Skill 身份来源确认 AgentResolver 已按选择 ID 取定义，无需增加另一层 catalog 授权逻辑。随后发现 parent 委派上下文在不继承工具结果时仅删除 tool 消息，仍保留 assistant.tool_calls。修复为调用与结果一起移除，保留非空 assistant 文本，跳过仅含调用的空消息；includeToolResults=true 保留原交换，父消息不变。

新增 3 项参数化绑定测试覆盖缺省/false/true、文本保留、空调用消息删除和父输入不变。Session 61 项及 Tauri 类型检查通过，日志 `/tmp/design-delegation-context-tests.log`、`/tmp/design-delegation-context-types.log`。该修复不等同于对任意损坏历史进行完整协议修复，也不完成 Skill 自动委派或调度恢复。

## Run 面板异步切换

DagWorkbench 增加视图请求版本与刷新序号：打开 Run、加载/选择草稿、destroy 后，旧响应不再切换模式或覆盖当前 Run；旧加载错误被忽略，旧轮询失败不会停止新 Run 的计时器。初始化迟到也不再重绘已经切换/销毁的视图。查询和刷新仍通过既有命令面，不修改 Kernel 状态。

新增 5 项 DOM 环境控制器测试，覆盖打开逆序、旧刷新成功/失败、新 Run 计时器保留、destroy 迟到和切回设计后的旧错误。app-shell 106 项通过、30 项跳过，Tauri 类型检查通过；日志 `/tmp/design-run-view-tests.log`、`/tmp/design-run-view-types.log`。这些测试将 render 替换为观察点，证明状态及计时器不被旧响应改写，不代替真实 GUI 渲染/交互验收。

## 浏览投影与首版范围复核

重新核对 SessionBrowser 和 SessionWorkbench：投影严格只读，编辑保存使用单独 Session 文件上下文，与当前浏览规范一致；删除审计入口中误增的侧栏 CRUD/通用插件必做结论。核对简化核心明确可选扩展与六类仍必须验收的故障，并将范围裁决集中到文首，防止把“简化”误解为无需完成恢复正确性。代码未修改，本批没有重复运行无关测试。

## Kernel 人工重试

补齐协议 §2 的人工重做不变量：TaskSpec/TaskRecord 增加 retryOfTaskId，createTask 事务校验来源终态；TaskHandle.retry/Kernel.retryTask 以来源和 requestId 组成幂等提交身份，复制执行输入和策略到新 root Task，deferStart=true，不复制 checkpoint/Effect/interaction 或资源授权。旧终态保持不变，依赖失败仍按既有提交规则传播。

新增 2 项真实 Kernel 测试覆盖已成功/已取消来源、并发相同请求幂等、不同请求创建不同身份、原记录不变、新任务重新执行，以及非法请求/非终态来源拒绝。durable-kernel 128 项、Kernel 与 Tauri 类型检查通过；日志 `/tmp/design-manual-retry-tests.log`、`/tmp/design-manual-retry-types.log`、`/tmp/design-manual-retry-app-types.log`。Flow 单节点重试的授权、成员关系、依赖与结果收敛尚未接入，仍属于有效未完成项。

## 人工重试创建边界与重建

检查所有 taskFromSpec 调用发现结构化 spawn 绕过了 retryOfTaskId 校验。提取事务内 validateRetrySourceTx，普通 createTask 和 createSpawnTaskTx 共用；来源为空、缺失或非终态时拒绝，子任务及其映射不发布，父提交依既有失败策略处理。

新增 2 项真实 Kernel 测试：结构化 spawn 引用未终态来源时提交失败且无重试子任务；dispose/waitIdle 后重建 Kernel，相同人工 requestId 返回原重试身份、保持新任务 created 与旧任务 cancelled。durable-kernel 130 项及 Tauri 类型检查通过；日志 `/tmp/design-retry-boundary-tests.log`、`/tmp/design-retry-boundary-types.log`。这是运行时对象重建证据，尚未新增 OS 进程 kill 测试；Flow 重试与调度恢复仍未完成。

## 能力资源创建幂等回执

推进 Flow 重试授权时发现低层 createResource 没有幂等身份，返回丢失后会重复创建。增加 owner Task 作用域 requestId，资源/句柄/事件/规格指纹回执同事务提交。重放返回当前资源和句柄，规格冲突拒绝，撤销状态不被重建；未声明请求 ID 的既有调用保持原语义。

新增 2 项真实 Kernel 测试覆盖并发同请求单资源/单事件、规格冲突、不同 owner 隔离、撤销后重放、重建 Kernel 后同一身份以及空请求拒绝。durable-kernel 132 项、Kernel 与 Tauri 类型检查通过；日志 `/tmp/design-resource-create-tests.log`、`/tmp/design-resource-create-types.log`、`/tmp/design-resource-create-app-types.log`。首轮撤销测试缺 admin 权限，修正测试权限后重跑通过；没有修改撤销授权要求。Flow 重试装配、授权信号/start 的恢复及结果关联仍待完成。

## 能力信号与原子启动

TaskStartOptions 支持初始 signal。startTask 在同一记录事务写入 start-signal 指纹、pending signal、ready/blocked 状态和信号/启动事件；同信号重放不重复投递，不同信号冲突。bindCapabilities 改为稳定 signalKey 资源回执及原子 start，避免 signal/start 间的独立提交窗口。资源创建与准备回调仍在此前完成，回调必须可重试。

新增 2 项真实 Kernel 测试覆盖并发启动、冲突、Kernel 重建后重放、准备失败保持 created、再次准备复用原授权。Kernel 134 项、Flow 101 项、Session 61 项及 Kernel/Tauri 类型检查通过；日志 `/tmp/design-atomic-start-tests.log`、`/tmp/design-atomic-start-flow-tests.log`、`/tmp/design-atomic-start-session-tests.log`、`/tmp/design-atomic-start-types.log`、`/tmp/design-atomic-start-app-types.log`。未新增真实 OS kill 验收；Flow 手工重试仍需成员关系与结果接线。

## Flow 重试成员登记

根 runTasks 新增节点 budget 快照；新增 prepareFlowTaskRetry 验证成员、创建 deferred 人工重试，并通过 shared CAS 登记 nodeId/iteration/retryOfTaskId/budget。相同请求幂等，不同请求并发分配实例序号；登记失败不启动，下一次同请求可恢复登记。RunGet、记录重连和 transcript 共用合并成员查询。

新增真实 Kernel 并发测试覆盖相同/不同请求、唯一实例序号、预算保存、created 状态、重连后成员可见、transcript 归属及非法请求拒绝。Flow 102 项、Flow 与 Tauri 类型检查通过，日志 `/tmp/design-retry-members-tests.log`、`/tmp/design-retry-members-types.log`、`/tmp/design-retry-members-app-types.log`。本批只完成准备与成员记录；命令/UI、授权启动、下游重算和结果收敛仍未完成，不能宣称完整 Run retry。

## Flow 单任务重试启动

新增 retryFlowTask 与 dag.run.task.retry，先准备持久成员，再按原 Task input 的工具白名单和保存的节点预算授权/启动。抽出共享 Flow 能力绑定函数供正常提交和重试使用，LLM 复用能力资源回执及原子启动；非 LLM start。并发调用若同一任务已离开 created，返回该既有执行身份。命令刷新成员视图，旧根结果不变。

新增真实 Kernel 命令测试覆盖并发请求同身份、实际 LLM Task 成功、单资源/单启动事件、节点预算恢复、白名单不扩大、任务树/transcript 可查询、终态重复请求及旧根结果保留。Flow 103 项、Flow/Tauri 类型检查通过；日志 `/tmp/design-flow-retry-start-tests.log`、`/tmp/design-flow-retry-start-types.log`、`/tmp/design-flow-retry-start-app-types.log`。仍未完成 UI、下游重算、重试产生的 graph effect 调度、workspace 重建及图级结果收敛，完整 Run retry 保持未完成。

## 单任务重试 UI 与成员取消

Run 面板为非根终态任务提供重试按钮及 retryOfTaskId 标记，提示只重执行该任务、不重算下游。请求 pending 时禁重，响应失败保留原 requestId 供重试；成功后可再次发起独立执行。刷新以根和全部成员终态为停止条件，原根已结束不再停止重试任务观察。修复 RunCancel 仅取消最新节点的缺口：刷新成员清单后对全部 Task 发起取消并等待所有结果，失败以 AggregateError 汇报。

新增 2 项 DOM 测试覆盖按钮/来源展示、失败请求身份复用、进行中禁重和根终态下继续轮询；新增真实 Kernel 测试验证旧缓存下的两个并发重试均被取消。app-shell 108 项通过/30 项跳过、Flow 104 项及 Tauri 类型检查通过；日志 `/tmp/design-retry-ui-tests.log`、`/tmp/design-retry-ui-flow-tests.log`、`/tmp/design-retry-ui-types.log`。真实 GUI/平台验收、下游重算、graph effects 与 workspace 恢复仍未完成。

## 并发重试的人工交互

修复面板和 RunRespond 仅查询最新节点实例的问题：逐 Task 展示请求，命令刷新成员并支持 targetTaskId；旧调用遇到多个同名 pending 请求明确报歧义。回应窗口固定原 Run/Task，避免切换视图后发送到其他 Run。

真实 Kernel 测试覆盖并发请求歧义、目标选择、越界拒绝和单一请求兼容；DOM 测试覆盖两个等待按钮及切换 Run 后的提交目标。Flow 105 项通过、app-shell 109 项通过/30 项跳过，Tauri 类型检查通过。日志：`/tmp/design-retry-interaction-flow.log`、`/tmp/design-retry-interaction-ui.log`、`/tmp/design-retry-interaction-types.log`。jsdom showModal 使用测试替身，未替代真实 GUI 验收；响应丢失后的回应幂等重放未实现。

## Run 控制目标与成员刷新

修复 Goal 窗口在切换 Run 后修改当前 Run 的错误，固定对话框原始根 Task；信号与取消完成后的刷新同样固定原始 Run，并捕获失败显示错误。RunSignal 与 RunTaskCancel 在成员校验和节点选择前刷新持久重试清单。

新增真实 Kernel 参数化测试覆盖旧缓存下按 Task/节点注入、取消新重试成员及越界拒绝；DOM 测试覆盖切换 Run 后保存原目标和失败提示。Flow 108 项通过、app-shell 110 项通过/30 项跳过，Tauri 类型检查通过。日志：`/tmp/design-run-control-flow.log`、`/tmp/design-run-control-ui.log`、`/tmp/design-run-control-types.log`。未声称完成调度恢复、Goal 更新与 Session 控制原子化或真实 GUI 验收。

## 端口 schema 内容注册与运行校验

新增按 id/version 精确匹配、不可覆盖并隔离调用方修改的 FlowSchemaRegistry，DagPluginRegistry 暴露 registerSchema/getSchema。发布/直接执行/patch 对目标端口的同名但未知 schema 引用报错；执行器在下游 Task 创建前按实际依赖提取规则验证成功上游数据，错误进入既有 submit 失败清理。未知 schema 关键字明确拒绝。

新增 9 项测试：定义隔离、受限关键字拒绝、嵌套对象/数组/枚举/必填/额外属性、三个图入口未知引用拒绝，以及真实 Kernel 合法值传递和非法值不创建下游。Flow 117 项通过；Tauri 类型检查通过。日志 `/tmp/design-port-schema-tests.log`、`/tmp/design-port-schema-types.log`。实现为文档列明的 JSON Schema 子集，不代表完整标准、结构兼容推导、自动 responseFormat 绑定、无消费边输出校验、持久冻结或 repair/continue 策略完成。

## 单次 Run 的图与端口契约隔离

修复注册清单及 Run 输入对象可被调用方原地修改的问题：注册时复制 manifest；提交前复制 spec/parameters，并缓存初始节点端口定义和 schema，动态新增定义首次使用后固定。缓存含未知引用，运行中后续注册不能把先前未解析的同名引用悄然替换。

新增 3 项测试覆盖注册清单隔离、缓存定义/未知引用/动态首次使用，以及真实 Kernel 异步 hook 修改原始图、源数据和 schema 后仍按提交时定义向下游传值。Flow 120 项通过，Tauri 类型检查通过；日志 `/tmp/design-run-contract-tests.log`、`/tmp/design-run-contract-types.log`。本批未实现跨进程持久冻结或插件代码版本冻结。

## Skill 持久卸载工具入口

注册 unload_skill 到 KernelAdapters 核心工具目录，tool.call 在授权检查后依据可信卸载 metadata，先 CAS 删除 loaded ID 再执行活动作用域卸载。存储失败不撤销当前技能；卸载调用不先恢复旧 loaded 列表，因此可以清理已删除定义。既有 Task 指令/工具快照保持历史事实，调用仍受工具白名单和资源授权约束。UI 入口及运行中上下文更新仍待完成。

新增运行时集成测试覆盖目录注册、加载/卸载/作用域重建、定义删除后清理，以及持久写失败保留活动技能。kernel-adapters 56 项通过，Tauri 类型检查通过。日志 `/tmp/design-unload-tool-tests.log`、`/tmp/design-unload-tool-types.log`。

## Skill 卸载失败边界与损坏记录

修复 loaded-state 更新静默过滤损坏身份的问题，恢复与更新共用严格解析；损坏列表在 load/unload 写入前拒绝。补测 tool.call 无授权、禁用、无效参数、缺少持久状态时不写入/调用，以及持久删除后本地清理失败重试不重复写记录。

新增 8 项回归测试，kernel-adapters 64 项通过；类型检查日志 `/tmp/design-unload-boundaries-types.log`，测试日志 `/tmp/design-unload-boundaries-tests.log`。这些是适配器与状态更新边界验证，不替代 OS 故障或真实 GUI 验收。

## Session Skill 卸载面板接线

新增宿主 SessionSkillControls，列出持久或活动 loaded ID（包括缺失定义），先持久删除后卸载目标 Session 的活动技能。app-shell 通过编辑器工厂注入聊天 Skill 面板；成功刷新列表，失败恢复勾选并显示错误，特殊字符 ID 不再拼接到 CSS selector。UI 操作不伪装为模型 Effect，不新增模型权限。

新增 2 项服务边界测试覆盖目标 Session 隔离/缺失定义/持久失败不获取活动作用域，2 项 DOM 测试覆盖成功卸载刷新、失败恢复和特殊字符 ID。测试日志 `/tmp/design-skill-controls-tests.log`、`/tmp/design-skill-controls-ui.log`，类型检查 `/tmp/design-skill-controls-types.log`。kernel-adapters 66 项、app-shell 112 项通过/30 项跳过，Tauri 类型检查通过。本批未验收真实 GUI，面板仅提供已加载项卸载，完整可用技能显式加载 UI 和运行中上下文更新仍待实现。

## Skill 面板显式加载闭环

SessionSkillControls 新增 list/load 并接入 ChatInput：展示作用域已知技能与持久已加载缺失项，禁用不可进入模型上下文的未加载项，成功加载后保存 loaded ID。保存失败只撤销本次新增活动加载，保留之前已加载项。UI 服务按 Session 串行处理操作；不同 Session 独立。成功后刷新列表，失败恢复勾选并显示错误。

新增 6 项服务测试及 2 项 DOM 测试覆盖保存失败回滚、已加载项保留、快速加载/卸载顺序、禁用/静默/action 策略和加载失败界面恢复。kernel-adapters 72 项、app-shell 114 项通过/30 项跳过，Tauri 类型检查通过。日志 `/tmp/design-skill-load-ui-adapters.log`、`/tmp/design-skill-load-ui-tests.log`、`/tmp/design-skill-load-ui-types.log`。UI 与模型 Effect 的并发协调、运行中上下文更新、来源实时刷新及真实 GUI 验收仍未完成。

## UI、Effect 与新运行的 Skill 操作协调

将 UI 私有队列提升为按 SessionCapabilityRegistry/Session 共享的操作队列，覆盖 UI 控制、专用 Skill Effect、可信 loader/unloader 工具（执行/reconcile）及宿主新运行上下文自动加载。普通工具仅在状态恢复阶段排队，保留实际工具执行并发。Effect 包装保留 recoveryPolicy、cancel、reconcile 的接口语义。

新增 4 项测试覆盖工具/专用加载暂停后 UI 卸载顺序及重建不恢复、不同 Session/运行时隔离、失败释放队列和适配器恢复/取消契约。kernel-adapters 76 项通过，Tauri 类型检查通过；日志 `/tmp/design-skill-queue-tests.log`、`/tmp/design-skill-queue-types.log`。本批为单宿主进程内协调，不是跨进程事务或对直接 SkillService 调用的全局锁；运行中上下文更新与编辑器生命周期仍未完成。

## Skill 队列权限与取消边界

修复协调包装器在工具授权检查前获取 Session 作用域的问题：tool.call execute/reconcile 均先检查 grant，再读取可信 metadata。排队 Skill 变更在执行前检查取消信号，取消后不调用原 Effect，也不阻塞后续队列。

新增 3 项测试覆盖 execute/reconcile 无授权不解析作用域、排队取消不执行且后续继续。kernel-adapters 79 项通过，Tauri 类型检查通过；日志 `/tmp/design-skill-queue-auth-tests.log`、`/tmp/design-skill-queue-auth-types.log`。仍不声称实现跨进程锁或取消与已开始外部副作用的原子化。

## Skill 队列随作用域销毁失效

SessionCapabilityRegistry.disposeSession 在移除作用域前使旧队列失效，关闭期间拒绝新操作，完成后允许新队列；dispose 永久关闭 registry 队列。未开始的旧操作不会重新获取已销毁作用域或写入持久状态。

新增 2 项测试覆盖运行时销毁后的排队 UI 卸载不执行/持久记录不变、重开后新操作可用、关闭期间拒绝及整体关闭拒绝。kernel-adapters 81 项通过，Tauri 类型检查通过；日志 `/tmp/design-skill-queue-close-tests.log`、`/tmp/design-skill-queue-close-types.log`。已开始执行的操作仍需原有 driver fence/取消机制，本批不宣称其与持久写入原子关闭。

## 跨包回归与 CLI 监听错误诊断

在近期 Flow/Skill/UI 变更后的同一工作树重跑 durable-kernel 134 项、llm-flow 120 项、llm-session 61 项、app-shell 114 项（30 项跳过），全部通过。日志分别为 `/tmp/design-cross-kernel.log`、`/tmp/design-cross-flow.log`、`/tmp/design-cross-session.log`、`/tmp/design-cross-app.log`。

CLI 沙箱内集成测试在 HTTP 服务启动阶段超时；独立监听探针确认 EPERM，终止该轮后使用已授权沙箱外环境重跑 49 项全部通过。修复三个集成测试的 mock 服务启动 Promise：共享 listenForTest 处理监听 error，失败立即拒绝，不再等整项超时。修改后 CLI 全套再跑 49 项通过，日志 `/tmp/design-cross-cli-verified.log`。这些结果不代替原生 GUI/OS 隔离验收，也不证明未实现的调度恢复完成。

## 工作区清理状态持久化与面板展示

补齐执行器已有 workspaceCompletion 的消费链：清理前保存 pending 到 Session shared，完成后保存成功/失败，RunGet 在重连时读取，面板显示错误且 pending 时保持轮询。清理状态与根 Task 结果独立；保存结果失败仍以 workspaceCompletion 拒绝暴露，持久 pending 不代表清理完成。

新增真实 Kernel 测试覆盖清理挂起、失败与命令服务重连读取，DOM 测试覆盖根任务完成后的继续轮询和错误文本安全呈现。Flow 121 项、app-shell 115 项通过/30 项跳过，Tauri 类型检查通过。日志 `/tmp/design-workspace-status-flow.log`、`/tmp/design-workspace-status-ui.log`、`/tmp/design-workspace-status-types.log`。平台管理器装配与崩溃清理恢复仍未完成。

## 区分工作区清理失败和状态保存失败

修复清理成功但最终状态写入失败被误标为清理失败的问题：保留清理 status，独立 persistenceError；双重失败保留 AggregateError 原因，finish 只调用一次。面板分别展示清理结果和保存错误，根 Task 结果不变。

新增 3 项收尾边界测试及 1 项 DOM 测试；Flow 124 项、app-shell 116 项通过/30 项跳过，Tauri 类型检查通过。日志 `/tmp/design-workspace-persistence-tests.log`、`/tmp/design-workspace-persistence-ui.log`、`/tmp/design-workspace-persistence-types.log`。保存失败时重连只能读取最后已保存记录，未声称解决崩溃后的收尾恢复。

## Transcript 纯文本导出

Run transcript 对话框新增 UTF-8 纯文本导出，与 JSON 共用完整分页门控。文本头保留 Session/Run/Task、节点、状态、version、交换总数，正文包含完整输入、每条持久 Effect、交互和输出；不会导出仅首屏记录。同步修正 Flow 当前能力表中仍将单任务 retry 写成待办的旧描述，下游重算仍保持未完成。

新增 DOM 测试覆盖未读完禁用、合并两页后的文本内容/身份/文件名/MIME。app-shell 117 项通过/30 项跳过，Tauri 类型检查通过；日志 `/tmp/design-transcript-text-tests.log`、`/tmp/design-transcript-text-types.log`。真实平台下载验收及存储层分页仍未完成。

## Memory provider 注入链与检索作用域

核对发现 SessionManager 虽有 retrieveMemory，但 ConversationSystemOptions 和 createSessionManager 工厂漏传。已补齐顶层注入，工厂参数复用构造器类型，检索回调新增当前 Session 与复制后的 Agent memoryPolicy，保持两参数旧回调兼容。

扩展真实 Kernel 直聊测试为有/无 memory 两种情况，验证回调作用域/策略副本和记忆进入持久 Task 输入。Session 62 项通过，Tauri 类型检查通过；日志 `/tmp/design-memory-context-tests.log`、`/tmp/design-memory-context-types.log`。实际持久 provider、跨 Session 授权/存储仍未完成，不能以注入链接通替代。

## Session 持久 memory provider

实现并默认装配 SessionMemoryProvider：按 Session/namespace/精确 scope 存储，可信宿主 upsert/remove 检查 writeScopes，retrieve 只读 readScopes；CAS 合并防止并发写丢失，更新/删除不改写已返回结果。返回内容摘要和 scope 编码身份，支持词项匹配/更新时间排序及 retrievalLimit。无策略或 limit=0 不打开存储。

新增 3 项真实 Kernel 测试覆盖并发合并、Session/namespace/scope 隔离、Kernel 重建、更新删除、策略拒绝和损坏记录保护。Session 65 项、app-shell 117 项通过/30 项跳过，Tauri 类型检查通过；日志 `/tmp/design-memory-provider-tests.log`、`/tmp/design-memory-provider-app.log`、`/tmp/design-memory-provider-types.log`。当前为 Session 内持久记忆与词项检索；跨 Session 共享、模型记忆工具/UI、向量检索和存储分页未完成。

## 临时 Flow 不隐式检索父 Agent 记忆

核对发现节点绑定器虽过滤 memory system 消息，executeDag 组装阶段仍会检索并把记忆放进交给 createSpec 的快照。已在 Flow 组装入口关闭检索，直聊保持原策略；避免依赖后续节点过滤来实现边界。

扩展真实 Kernel 有/无 memory 参数化测试：直聊输入维持预期，随后执行 Flow 不调用 provider，编译快照无 memory 块/正文。Session 65 项和 Tauri 类型检查通过；日志 `/tmp/design-flow-memory-boundary-tests.log`、`/tmp/design-flow-memory-boundary-types.log`。显式 Flow 文本输入保持可用，未把跨 Session 共享或记忆写入工具标记完成。

## 终态交互响应幂等重放

协议核验发现 resolveInteraction 在已保存回应去重前拒绝终态，导致回应成功但响应丢失后的重试失败。调整为先识别 resolved 同值重放，异值冲突；未解决的终态交互仍不能推进。Flow RunRespond 指定 targetTaskId 时支持这一路径，省略目标仍只匹配 pending。

新增 Kernel 三种终态测试，在重建后比较重放前后的完整 TaskRecord/事件列表；扩展 Flow 并发交互测试确认指定旧实例重放不会回应另一个 pending 实例。Kernel 137 项、Flow 124 项与 Tauri 类型检查通过；日志 `/tmp/design-interaction-replay-kernel.log`、`/tmp/design-interaction-replay-flow.log`、`/tmp/design-interaction-replay-types.log`。尚未据此认定全部终态入口审计完成。

## 终态生命周期控制核验矩阵

新增三种终态参数化测试，逐项调用 start、带初始信号的 start 重放、signal、cancel、新 pause/resume/interrupt、已有控制回执重放与同键冲突；比较完整目标 TaskRecord 和事件页均不变。没有发现这些入口需要新的生产代码修补。

Kernel 140 项通过，日志 `/tmp/design-terminal-controls-tests.log`。协议文档新增入口/行为/证据矩阵，明确目标 Task 不变不等于子任务或外部进程停止语义已验收，仍保留 Effect/恢复等入口审计。

## 祖先取消后迟到 Effect 的提交屏障

completeEffect 原先只检查 Effect lease，祖先已经取消但后代清理尚未传播时，迟到结果仍可写入并唤醒任务或安排重试。现将祖先取消检查纳入同一完成事务，与 claim/续租及受保护写入的取消屏障对齐；已保存结果的幂等返回不变。

新增四种结果测试覆盖成功、失败、自动重试和不确定结果，在三层任务中只取消祖先，验证后代 TaskRecord 和事件完全不变。修补前四项均失败，修补后 durable-kernel 全部 144 项及类型检查通过；日志 `/tmp/design-ancestor-effect-red.log`、`/tmp/design-ancestor-effect-tests.log`、`/tmp/design-ancestor-effect-types.log`。同步修正当前覆盖表仍把已完成 Skill 卸载入口列为待办的过期描述。本批不声称完成 OS 故障或外部清理验收。

## 人工 Effect 裁决的祖先取消屏障

resolveEffect 原先只拒绝目标 Task 自身终态，祖先取消尚未传播时仍接受人工完成、失败和重试裁决。现于回执重放之后、任何新裁决写入之前，在同一事务中检查祖先取消状态；已有同请求同内容的回执可重放，异内容冲突。

修补前三种新裁决测试均失败；新增共六项参数化测试覆盖三种裁决在取消前保存后重放及取消后首次提交，并比较 TaskRecord/事件无变更。durable-kernel 全部 150 项及类型检查通过，日志 `/tmp/design-ancestor-resolution-red.log`、`/tmp/design-ancestor-resolution-tests.log`、`/tmp/design-ancestor-resolution-types.log`。验证范围为持久事务入口，外部副作用及 OS 故障验收继续保留。

## 后代任务外部入口的祖先取消屏障

核对发现 createTask 只检查直接父任务，start/signal/control/resolveInteraction 也未检查祖先取消。现在新后代创建、首次启动、新信号/控制及 pending 交互回应在写入事务内拒绝已取消祖先；提交、启动信号、控制及已解决交互的原回执重放保持不变。

七种新操作测试在修补前全部失败；连同交互新回应/已保存回应的两项测试，共新增九项验证，逐值比较目标 TaskRecord 与事件。durable-kernel 全部 159 项及类型检查、Flow 消费端全部 124 项通过，日志 `/tmp/design-ancestor-controls-red.log`、`/tmp/design-ancestor-controls-tests.log`、`/tmp/design-ancestor-controls-types.log`、`/tmp/design-ancestor-controls-flow.log`。剩余消息接收、恢复扫描与物理清理边界仍需核验。

## 消息收发的祖先取消屏障

修复同 Session/跨 Session 投递仅检查目标自身终态的缺口：目标祖先取消时保存 `target-ancestor-cancelled` 拒绝回执，不改写目标 Task；发送方祖先取消后也不能入队新消息。原入队和投递/拒绝回执仍优先校验身份并重放，已成功投递不因后来取消而撤回。

新增六项测试；修补前两种接收路径与新发送共三项失败，已有回执三项通过。最终 durable-kernel 全部 165 项和类型检查通过，日志 `/tmp/design-ancestor-mailbox-red.log`、`/tmp/design-ancestor-sender-red.log`、`/tmp/design-ancestor-mailbox-tests.log`、`/tmp/design-ancestor-mailbox-types.log`。这些测试覆盖持久消息事务与重复投递，不替代跨进程 relay 故障、恢复扫描及物理清理验收。

## 恢复扫描中的取消传播顺序

sweep 原先只检查直接父任务，后代先被扫描时漏掉本轮取消；recover 本身未传播祖先取消。两条路径现于逐任务 lease 恢复之前调用共用取消处理，在同一事务内检查完整祖先链并提交取消及清理标记，避免依赖父任务扫描顺序。

新增两项三层任务测试，sweep 强制后代优先枚举，recover 验证显式恢复传播；覆盖过期 Effect 的取消/清理标记及再次恢复无重复写入。修补前两项失败；最终 durable-kernel 全部 167 项、类型检查通过，日志 `/tmp/design-cancel-recovery-red.log`、`/tmp/design-cancel-recovery-tests.log`、`/tmp/design-cancel-recovery-types.log`。这是存储入口验证，不声称 OS 崩溃或物理资源清理全量验收完成。

## 父取消提交后的跨进程崩溃验收

LocalFS IPC worker 新增三层任务和 leased Effect 场景，在父任务取消事务提交后、后代传播前停在 crashpoint，由测试宿主执行 SIGKILL。新进程先确认父 cancelled、后代仍 created/waiting 且旧 lease 未过期，验证旧结果提交被拒绝且记录不变，再显式 recover 到全树 cancelled/Effect cleanupPending。第二次 SIGKILL/新进程恢复验证记录、事件与单次取消事件保持不变。

root/module 两种挂载模式新增两项均通过，20-kernel-ipc 全部 26 项通过，日志 `/tmp/design-cancel-tree-ipc-tests.log`。这补充了协议 §15 父取消提交后、后代清理前的真实 OS 故障证据；外部 Effect 使用持久记录夹具，测试不声称物理设备停止或完整故障矩阵已完成。

## Effect 清理适配器的跨进程恢复验收

核验 Kernel 恢复轮询已有实现，新增 root/module 两种挂载测试：父取消提交后 SIGKILL，新进程遇到缺失适配器、无 cancel 的适配器、cancel 抛错时均保留 cleanupPending；再次 SIGKILL/重启后成功 cancel 才清除标记；再重启不重复调用，TaskRecord 保持终态。

本批无需修改生产实现。LocalFS IPC 全部 28 项通过，日志 `/tmp/design-effect-cleanup-ipc-tests.log`。测试证明真实进程重启下的持久清理确认链，适配器为测试实现；实际设备停止、永久挂起的 cancel 超时/隔离仍未验收。

## Effect 清理等待上限

修复 adapter.cancel 永久挂起会卡住取消调用/恢复轮询的问题：增加 KernelOptions.effectCleanupTimeoutMs（默认 30s），超时不确认清理，保留 cleanupPending。EffectCleanupRunner 在单 Kernel 任务清理路径中合并同一 Effect 尚未结束的调用，超时后不重复启动重叠操作；其他 Effect 可独立完成。没有将等待超时宣称为外部操作终止或跨进程锁。

新增八项运行时测试，扩展 LocalFS 两种挂载模式的恢复测试覆盖挂起 cancel。Kernel 全部 175 项、类型检查及 LocalFS IPC 全部 28 项通过，日志 `/tmp/design-cleanup-timeout-tests.log`、`/tmp/design-cleanup-timeout-types.log`、`/tmp/design-cleanup-timeout-ipc.log`。同步修正 Kernel API 文档中 pollMs 默认 250ms 的旧描述为当前 0。实际设备停止和进程隔离验收仍未完成。

## 下一批工作

1. 补齐 C4/浏览/挂载剩余 GUI 与平台验收；完成 Skill 运行中更新、L4 编辑器生命周期、作用域销毁/重建并发核验、初始化工具激活、版本冻结与委派。
2. 补齐 Flow 有效目标：持久调度恢复、统一任务工具、Run retry、transcript 存储分页与平台导出验收、schema 结构推导/responseFormat 绑定/端口错误策略、memory 跨 Session 共享/模型写入入口，以及平台装配与恢复测试。
3. 对 durable-harness 五篇文档逐项建立目标/API/记录/故障测试映射，实现仍有效的缺口，避免把简化核心明确排除的扩展误当作已完成。
4. 运行对应包与消费端验证，复核全部文档和遗留任务后才认定整体完成。
