# Harness Session 交接：状态、侧栏搜索与本地体验对齐

更新日期：2026-10-09。本文基于当前工作树和已安装依赖核查，记录此前实施结果、本轮分析结论及后续任务。第 1–8 节保留接手前快照；本轮实施与验证结果见第 9 节。此前基线已提交推送，本轮改动尚未提交。

## 1. 当前结论

| 用户关心的问题 | 当前实现 | 需要补齐 |
| --- | --- | --- |
| 能否获取 harness session 运行状态？ | 可以获取原生 `status`、`activeTurnId`、控制权及事件；打开的会话界面会轮询 | 统一状态语义、观测时效，以及未打开会话的状态订阅 |
| sidebar 能否按运行状态显示图标？ | 当前全部使用 `ENTITY_ICONS.remoteSession`；状态没有进入侧栏节点投影 | 保留远程标识，增加运行、等待、异常、离线等状态标记和提示 |
| sidebar search 能否搜索远程文件？ | 能过滤已加载文件节点的标题；不会递归搜索未展开目录或远程文件正文 | 项目范围的服务端文件搜索及异步结果界面 |
| sidebar search 能否搜索 harness session？ | 能过滤已加载会话标题；不会遍历后续分页或检索会话正文 | 完整标题检索、原生会话正文检索，以及命中定位 |
| 是否已经使用统一 llm-ui？ | 已复用 workspace/titlebar、ChatInput、HistoryView、MDx 展示与常用操作 | 根据原生能力补齐管理与导航功能；不能直接套用本地 Kernel 的执行语义 |

当前 search 是已加载树的筛选，这一限制也适用于本地侧栏；不要将“本地已经有完整全文搜索”作为远程对齐的前提。

原生历史可读不等于所有运行过程均可实时观测。特别是独立 Codex CLI、其他 app-server 或其他客户端运行的会话，其实时状态覆盖范围需要实测。无法确认时显示“未知”或“观测已过期”，不能用文件修改时间、最后一条日志或缺少活动 turn 推断已经结束。

## 2. 仓库与提交基线

| 仓库 | 分支 | 已提交并推送的基线 |
| --- | --- | --- |
| itookit | `v5.3` | `6fb95853` — `feat(pi-agent): integrate MCP projects and native harness sessions` |
| [tools/pi-agent](tools/pi-agent) | `main` | `8614c54` — `feat(pi-agent): add controlled projects, sync and harness plugins` |
| [packages/piagent-driver](packages/piagent-driver) | `main` | `0b6e3ea` — `feat(piagent-driver): unify files, projects, sync and harness clients` |

本轮核查开始时三个仓库均干净，HEAD 与各自本地记录的 upstream 一致；这不是重新访问远端后的检查。主仓库的 gitlink 已指向上述子仓库提交。本文新增后需要由后续提交记录接续。

新检出环境：

```bash
git submodule update --init packages/piagent-driver tools/pi-agent
pnpm install --frozen-lockfile
```

依赖规则见 [npm 库消费约定](doc/design/npm-library-consumption.md)。`piagent-driver` 当前是显式 workspace 例外；npm 发布元数据和产物入口已整理，不能据此认为已经发布 npm。侧栏消费的是注册表中的 `@itookit/vfs-ui@0.5.5`。本地忽略的 `packages/vfs-ui` 独立检出可用于研究，修改它不会自动成为宿主使用的产物。

## 3. 此前已完成的进展

### 3.1 PI Agent、连接与项目模型

- `fs-agent` 已改名为 `pi-agent`，驱动及物理目录改为 `piagent-driver`；GitHub 地址、README、包信息和主仓库引用已更新。历史 wire 标识中的 `fsagent` 等兼容字段保留，后续不要机械替换。
- API Key / Bearer 认证、配置文件字段及启动时连接信息输出已实现；日志以便于观察的时间开头。不要在交接材料、测试输出或诊断中复制实际凭据和会话正文。
- 工具箱 MCP 配置支持多个 PI Agent 实例；通过能力声明及验证关联，不能只凭 MCP 名字授予绑定。普通 MCP 不应承担 PI Agent 专属探测。MCP 运行连接状态与持久配置分离。
- `exports` 定义可授权目录范围，项目可以绑定任意合法层级的子目录；私有 project catalog 存名称、目录身份、权限和 mount 策略，不是工作目录。真实路径规范化后，同一服务器及认证身份下的相同目录复用服务端项目。
- 远程项目显示“服务器名:项目名”；文件、bash 和 harness 使用统一项目授权与 revision。新协议支持可写文件根；旧无项目协议的绑定保留只读兼容。
- 项目执行通过公共 ProjectLauncher / Bubblewrap 隔离端口，保留后续 VMM 扩展位置。VMM、强跨进程执行租约和更细项目级并发还没有完成。
- 同步支持上传、下载、双向、预览及冲突选择，并保留 revision / epoch / requestId 的结果核对。项目同步与 MCP 状态已有图标和异常提示；这不代表 harness session 已接入同一状态展示。
- MCP 删除预览显示配置名和引用项目名；强制移除清理本地远程项目记录、相关本地会话及绑定，保留服务器目录和原生 harness 会话。旧残留引用有清理逻辑。

具体模型见 [项目模型](doc/design/pi-agent-project-model.md)、[目录同步](doc/design/pi-agent-sync.md)。sync 数据集身份与可执行目录项目身份不同，不能混用。

### 3.2 Harness 与会话展示

- 通过 `HarnessPlugin` / `HarnessDriver` 接入原生 harness，目前实际实现 Codex；Claude Code、DeepSeek 等尚待独立插件适配。
- 支持配置原生 home，按授权真实 cwd / 项目虚拟 cwd 获取会话，而不是硬编码默认目录。会话正文和原生存储仍由 harness 管理。
- 项目根绑定下显示 profile / 原生会话；远程 Agent 出现在工具箱及输入选择，发送直接走远程 harness，不退回本地 `device-llm`。
- 支持原生历史读取、创建、恢复、发送 turn、审批与问题回复、停止受控 turn、fork、事件及操作 receipt 查询。关闭会话界面释放客户端等待，不等同于停止原生 turn。
- 本地和远程共享 llm-ui 展示组件与 titlebar，通过 `ConversationControls` 接入原生控制，执行所有权、结果核对和原生事件仍由独立服务管理。
- 已修正可读标题、时间单位、最后修改时间倒序、分支元数据和历史分页；历史较早部分可继续加载，尚未实现自动完整全文索引。
- 同一 turn 的响应聚合展示，tool 默认显示工具名、命令第一行或文件操作摘要；真实用户数组边界保留，并在 Markdown 中用 `\n\n---\n\n` 区分。用户消息前多余的 `>` 已去除。
- 增加连接恢复及分阶段诊断，区分本地 MCP 引用找不到与服务端文件不存在，避免单凭 `[ENOENT]` 误判原生会话丢失。

### 3.3 上轮审查修复与验证

审查中修复了 MCP 删除预览被运行状态刷新误判过期、统一驱动 `open` 覆盖后递归、文件接口未保留注入 fetch、CLI 临时 IPC bundle 依赖解析和 cwd 测试使用真实工作目录等问题，并更新认证示例与子模块检出说明。

上轮完成：

- 根仓库 `pnpm test` 完整配置矩阵，包括 CLI 常规测试、crash matrix 和 Tauri Rust 边界测试。
- `PI_AGENT_HARNESS_TEST=1 pnpm --filter @itookit/piagent-driver test`：91 项通过；包含真实 Rust 网关、MCP SDK v2 和确定性原生 stdio 测试 peer，不是实际云模型调用验收。
- PI Agent `cargo test --features sync-fault-injection`、`cargo fmt --check`。
- 全仓 typecheck、docs、styles、architecture 检查及相关 release 脚本测试。
- Web、Tauri 前端、CLI、piagent-driver、llm-ui 构建。未将这些构建描述为桌面视觉端到端验收。

日志在当时的 `/tmp/pi-agent-review-*.log` 下，包括 `tests-complete`、`driver-network`、`rust-full`、`types-complete`、`docs`、`styles` 和相关 `build-final`；这些临时文件不是永久交付证据。本轮分析没有重新执行完整测试矩阵。

## 4. 运行状态：数据已有，侧栏链路缺失

### 4.1 现有链路与断点

| 层 | 当前行为 | 关键代码 |
| --- | --- | --- |
| PI Agent | `thread/list` 默认每页 25 项、按 `updated_at` 排序；返回原生 status type、时间、owned 和能找到的活动 turn | [codex.rs](tools/pi-agent/src/harness/codex.rs) |
| 事件服务 | 有界事件重放、epoch、gap、原生请求及其解决通知 | [events.rs](tools/pi-agent/src/harness/events.rs) |
| 驱动契约 | `HarnessSession.status / activeTurnId / owned`，`inspect`、`events` 和 receipt | [contracts.ts](packages/piagent-driver/src/harness/contracts.ts) |
| Conversation 服务 | 计算 active，处理 turn 开始/结束、requests、断线及结果未知 | [conversation.ts](packages/piagent-driver/src/harness/conversation.ts) |
| 打开的正文 | 每约 1 秒串行 poll，更新顶栏状态和交互请求 | [RemoteConversationEditor.ts](packages/llm-ui/src/shell/RemoteConversationEditor.ts) |
| 侧栏投影 | 只投影标题、时间、只读及远程标记，所有节点使用同一个远程图标 | [remote-session-projection.ts](packages/app-core/src/session/remote-session-projection.ts) |
| 侧栏/标签页 | 调整排序和时间说明；标签页也使用固定远程图标，没有共享原生会话状态订阅 | [navigation-policy.ts](packages/app-shell/src/projects/navigation-policy.ts)、[SessionWorkbench.ts](packages/app-shell/src/projects/SessionWorkbench.ts) |

`thread/list` 可能没有 turns，不能要求列表中的 `activeTurnId` 总能填充。PI Agent 当前取 `status.type`，还需要核对原生状态的附加字段与不同版本差异，避免丢失审批/输入等待等信息。

正文的状态映射也较粗：把 active 映射为 running，将断线/gap 映射为 failed，将 pending 映射为 queued。这里的 pending 是修改操作结果尚待核对，不等于等待用户审批。侧栏补齐时应同时修正这些语义，避免正文和侧栏互相矛盾。

### 4.2 P0：建立共享状态观察服务

建议在 app-core 定义状态查询/订阅用例，driver 负责原生状态解析，app-shell / llm-ui 消费同一结果。服务和新增接口名在此仅为方案，当前尚不存在。

最小观察记录应包含：

- 身份：MCP 配置身份、稳定 serverId、服务端 projectId、profileId、nativeSessionId；不能只用 sessionId 或展示名称作 key。
- 原生证据：raw status、活动 turn、最新 turn 结果、等待 requests、owned、观测来源及 observedAt。
- 执行语义：unknown、idle、running、waiting-approval、waiting-input；最近一次 turn 的 completed / failed / cancelled 应作为结果信息，不与当前可运行性混为一谈。
- 独立维度：连接状况、观测是否过期、操作 receipt 是否未知、操作能力。离线不能推断失败，未收到完成事件不能推断仍在运行。

实现顺序：

1. 先在已有列表、inspect 和打开的会话事件上统一归一化，保留原始状态证据；未知枚举退化为 unknown。
2. 状态投影进入 sidebar 节点与标签页；保留远程身份图标，用角标或组合图标表达状态。hover 显示状态、来源、观测时间和当前允许操作。
3. 对当前可见项目/profile 建立共享监视，复用事件及轻量元数据；若不足，再扩展服务端批量状态能力。不要对每行反复 `read()` 全量历史。
4. 对后台、隐藏或离线项目降低频率并退避；只有真实状态转换才触发节点更新，不因每个文本 delta 重建整个树。
5. epoch 改变或 gap 时重新取可信快照；目录授权 revision 变化、MCP 被移除或项目关闭时释放订阅并使旧观察失效。

观察必须是只读操作。不能为了知道状态而 resume/adopt 会话、启动 turn 或取得额外控制权；即使观察到外部运行，也只有当前受控且具备能力的会话允许 interrupt/respond。

所有图标从 common 导入，中文/英文 i18n 同步。若 vfs-ui 现有公开 presentation 端口无法表达角标或 tooltip，应扩展库公开接口并按独立 npm 库流程发布与升级，不能在宿主探查库内部 DOM。

## 5. 侧栏 search：当前范围与远程检索方案

### 5.1 为什么搜索遗漏内容

[SessionWorkbench.ts](packages/app-shell/src/projects/SessionWorkbench.ts) 将 query 交给目录投影及 vfs-ui，本轮没有发现服务端文件搜索或原生会话搜索端口。已安装 vfs-ui 的搜索使用节点 title、summary 和 searchableText；默认 NodeMapper 不为文件填充正文。

树只加载当前目录及已展开子目录；原生会话先加载一页，后续页通过 `@page` 节点继续读取。因此，未展开目录、未加载分页及正文都不属于当前 search 的覆盖范围。

[session-browser.ts](packages/app-core/src/session/session-browser.ts) 对 remote session 的通用 `read()` 明确返回 `EROFS: Remote sessions use the conversation port`。不能给通用 VFS 搜索器接上 `read()` 就认为获得原生会话全文搜索。

驱动现有 nativeShell 的 `ripgrep` 能力声明为 false，见 [process.ts](packages/piagent-driver/src/files/process.ts)。有 bash 执行能力，或者 tool 摘要能识别 `rg`，均不代表已经实现安全的 sidebar 搜索后端。

### 5.2 P1：统一搜索用例与异步结果

- 默认搜索当前项目；明确区分名称/路径、文件正文、会话标题、会话正文。全项目搜索必须显式选择范围。
- app-core 定义跨后端搜索端口，app-shell 管理输入、防抖、取消及导航，piagent-driver 管理传输，PI Agent 在服务器执行搜索；本地后端遵守同一结果契约。
- 结果应携带资源类型、稳定身份、项目/profile、文件相对路径或 native sessionId，以及行号或 turn/itemId、摘要、更新时间、是否截断和下一页 cursor。
- vfs-ui 现有同步筛选不能承担异步 I/O：选择新增公开异步 search/results 端口，或由宿主提供正式搜索结果视图。不能在同步 predicate 中发网络请求或预加载整个远程树。
- 界面区分“搜索中、无命中、部分结果、已取消、服务不可用”，并提供命中跳转与必要的高亮。快速切换 query 时丢弃过期响应。

### 5.3 P1：PI Agent 文件搜索使用 rg 加速

建议增加受项目约束的文件搜索能力，具体工具/HTTP 路由名称在实施时确定；不要把下面的方案当作已有 API。

1. 请求携带 projectId、revision、查询范围及有界参数。只读项目也可以搜索；接口只接受文本查询和受限选项，不接受任意宿主路径或任意命令。
2. 用固定 `rg` 可执行文件和独立 argv 启动，字面匹配默认、正则显式选择，使用结构化输出；用 `--` 分隔查询参数，不拼接 shell 字符串。
3. 复用授权项目的文件视图构建规则和 ProjectLauncher 隔离边界，搜索项目虚拟根及授予的 mount。读搜索不应要求新增写权限、网络权限或 harness 所有权。
4. 不能直接对宿主 export 根执行递归 rg：嵌套 mount 遮蔽、只读衰减、目录身份及 revision 必须与文件访问一致，防止扫到被遮蔽目录、未授权链接、私有 catalog 或原生认证文件。
5. 定义 `.gitignore`、隐藏文件、二进制文件及额外 mount 的统一策略；排除系统私有数据。巨大行、文件、匹配数、结果字节、执行时间和并发均设置上限，截断必须可见。
6. 支持取消及子进程回收；把 rg 的“无匹配”与执行失败区分。服务器没有 rg 时使用有界遍历回退或明确能力降级。
7. 检索期间和返回前核对授权与身份；命中导航时再校验。结果分页 cursor 应有版本/有效期，不能把失效分页静默当作完整结果。

### 5.4 P1：原生会话搜索不能只扫 home

- 标题搜索先解决全分页覆盖、项目过滤及 archived 范围，避免只搜索列表第一页。
- 正文搜索由具体 harness 插件负责理解原生格式。Codex 可利用 rg 找候选 JSONL 文件，再解析用户与 assistant 文本；搜索权限必须限制在当前项目/profile 已授权的原生会话。
- JSON 字符串转义、分段数组和跨 item 文本会影响原始文件匹配。rg 只能作为候选加速方式；需要解析回退或增量文本索引，保证“实际显示的文本”能被找到。
- tool 默认只参与摘要检索，不扫描巨大原始 payload；若提供深入搜索，应显式选择并应用容量限制。
- 不对整个 `~/.codex` 或自定义 home 无限制全文扫描，不暴露凭据及其他项目。不要把所有原生历史复制到本地 Session/Kernel，只为了让侧栏过滤生效。
- 命中结果应打开统一 llm-ui，定位到实际 turn/item，必要时分页加载较早历史；不是仅打开会话尾部。
- 新能力以服务端真实实现为准进行协商，旧 PI Agent、普通 MCP 和不支持检索的 harness 有明确退化体验。

## 6. 还需要与本地项目对齐的功能

| 功能 | 当前情况 | 后续任务 |
| --- | --- | --- |
| 运行/等待/异常展示 | 正文有粗粒度状态，sidebar 和标签页固定图标 | P0 共享观察服务及统一状态提示 |
| 搜索与命中跳转 | 已加载标题筛选，文件/会话全文没有接入 | P1 统一搜索端口、rg 后端及会话解析 |
| 附加 mount 的会话可见性 | remote session 根目前仅从 `at === '/'` 的服务端项目绑定生成 | P1 明确已注册项目被附加挂载时的会话来源与授权；普通目录挂载不自动授予 harness 控制权 |
| 收藏 | project favorite 类型及路由只覆盖文件与本地 session | P2 增加带完整远程身份的 session favorite；断线保留说明，移除绑定后成为可解释失效引用 |
| 重命名 | 远程 title 输入只读；通用 BrowserBackend rename 不支持原生 session | P2 按原生能力支持 rename，或明确本地显示别名，不能把别名误认为原生标题 |
| 归档/删除 | list 可查询 archived，项目 sidebar 没有归档筛选或原生管理命令；通用 delete 不支持原生 session | P2 补齐归档视图及能力声明；区分移除本地引用、归档原生会话、永久删除，并明确影响 |
| 分支/会话家族 | 已有 fork、parentSessionId、branchName 及正文分支入口 | P2 侧栏远程家族导航和关联会话列表；核验跨分页父子关系，不伪造本地 Kernel 分支 |
| 导出 | 正文可复制 Markdown、打印；sidebar 的 exportSessionItem 仅处理本地 session bundle | P2 原生只读导出及版本化元数据；是否导入为本地副本另行定义，不承诺保留原生可执行性 |
| 附件及执行参数 | 远程输入明确关闭附件，执行器锁定；工作目录/流程输出/重新运行等部分按钮隐藏 | P2 基于 harness capability 实施；缺少能力时解释原因，避免点击后才 EROFS |
| 文件更新与离线恢复 | 通用远程文件与连接诊断已接入；原生 turn 外部修改文件与 sidebar 的自动失效需要继续核验 | P2 项目级文件变更通知、有限刷新、重连后状态和目录同步 |
| 更多 harness | 仅 Codex 插件已实现 | P2 统一历史、状态、搜索和控制能力契约；其他 harness 分别提供格式与状态适配 |

原生执行并不属于本地 Kernel 的 Task/run 生命周期。可以对齐用户操作和呈现，不能直接复用本地取消、删除、rerun 或 durable recovery 来操作原生 turn。

## 7. 接手实施顺序与验收

### 第一步：先完成 P0 状态闭环

- 从驱动的原始 session、事件和 requests 建立纯函数状态映射，再接 app-core 的可测试查询/订阅端口。
- 侧栏先展示已知元数据状态，随后增加共享后台观测；与正文状态使用同一解释方式。
- 验证 running → waiting-approval/input → running → idle，以及 failed/cancelled 最近结果、断线、gap、epoch 变化和 unknown receipt。
- 至少验证一次独立启动的 Codex CLI 与一次由 PI Agent 创建的会话；分别记录“可观察”与“可控制”的范围。
- 未打开正文也能看到可信状态；打开多个标签页不产生重复监视。100 个会话不能产生每秒 100 次完整历史读取。
- 切换项目、撤销 grant、移除 MCP、关闭模块后订阅释放；关闭正文不停止原生 turn。未知状态不可触发自动 resume 或重放请求。

### 第二步：完成 P1 搜索闭环

- 先实现文件名称/路径及正文搜索的一个完整后端与 UI 跳转，再接原生会话标题和正文，避免同时改动所有层而无法验证。
- 验证未展开目录、第二页会话、较早历史、实际 user 数组文本、转义文本、归档会话及自定义原生 home 的命中。
- 验证授权嵌套 mount、被遮蔽路径、目录替换、revision 失效、链接、只读范围、私有目录不泄露。
- 验证以 `-` 开头的查询、含换行的文件名、二进制与巨大行、无 rg、超时取消、离线、部分结果及快速切换 query。
- 搜索命中必须导航到正确项目/profile/session/message，而不是使用展示名或错误 MCP 实例。
- 若扩展 vfs-ui，先在独立仓库测试、构建并发布，再更新 itookit 消费版本；干净安装后的行为必须与开发环境一致。

### 第三步：按能力补齐 P2 功能

优先收藏、归档视图、原生导出及分支家族；附件、rename、文件观察和新 harness 根据明确的后端能力推进。原生永久删除必须有独立影响说明和确认，不能借用“删除本地项目”清空服务器数据。

关键测试入口：

- [remote-session-projection.test.ts](packages/app-core/tests/remote-session-projection.test.ts)、[remote-session-workbench.test.ts](packages/app-shell/tests/remote-session-workbench.test.ts)：侧栏投影、路由、权限及生命周期。
- [remote-conversation-editor.test.ts](packages/app-shell/tests/remote-conversation-editor.test.ts)、[conversation.test.ts](packages/piagent-driver/tests/conversation.test.ts)：正文控制、状态、事件和未知结果。
- [project-navigation-reads.test.ts](packages/app-shell/tests/project-navigation-reads.test.ts)：防止刷新和导航增加无界 I/O。
- [network.test.ts](packages/piagent-driver/tests/network.test.ts)、[harness.rs](tools/pi-agent/tests/harness.rs)、[projects.rs](tools/pi-agent/tests/projects.rs)：真实边界及目录授权。
- [configuration-mcp-delete.test.ts](packages/app-core/tests/configuration-mcp-delete.test.ts)：配置删除、残留引用及状态刷新不改变删除身份。

每步运行受影响包的 test / typecheck；Rust 改动执行 fmt 与相应边界测试。跨包接口落地后执行 architecture、docs、styles 检查和必要的集成矩阵，明确区分协议测试 peer 与真实 harness 的人工验收。

## 8. 接手约束

- 遵守根及各包 AGENTS.md：中文交流、英文代码注释、Conventional Commits、原生 DOM、公共包入口和依赖方向。
- app-core 不引入 DOM 或 Node API；driver 不依赖 app-core/UI；原生文件格式、rg 子进程及隔离实现留在服务端/宿主适配层。
- 所有网络读取有容量限制、取消和响应验证；网络错误不能转成“文件/会话不存在”。日志只记录结构化诊断，不记录正文或凭据。
- 修改操作沿用 epoch / requestId / receipt；结果未知先核对，不能自动重复发送 turn。
- 对新增公开能力更新对应活文档与 capability 声明；本文是交接快照，后续可在任务列表补充完成提交与验收结果。


## 9. 本轮实施记录（2026-10-09）

已实现 P0 状态归一化、原生 activeFlags/最近结果、只读共享观察、epoch/gap 重取快照、授权时效与离线分离、侧栏和标签角标及统一正文提示。100 会话测试只做分页列表与 profile 事件，无逐行历史读取或 resume。

已实现 P1 当前项目的文件路径/正文搜索、固定 rg 的隔离只读后端、解析后的原生标题/正文及归档检索、异步取消与部分结果说明、身份校验、较早历史 item 定位。本地文件遵守同样的隐藏/私有/二进制和容量限制。已注册的附加挂载项目显示来源导航，普通目录挂载不自动成为 harness 来源。搜索是有界遍历；超限明确部分结果，当前没有无限索引或续页 cursor。

已实现 P2 优先项：完整身份远程收藏及失效保护、归档只读视图、原生版本化只读 JSON 导出、跨分页原生家族导航。原生 rename/archive/delete 修改、附件、更多 harness、文件变更事件推送与 VMM 按能力留待独立实现；当前不显示无后端支持的修改操作，也不以本地 Kernel 操作代替。

真实已安装 Codex 使用独立临时 home 和本地确定性 Responses 服务验收：受控会话 active → idle、owned=true；独立 CLI 正常退出，会话可读但状态 notLoaded、owned=false。因此外部执行的实时状态仍不可承诺，界面显示未知且不允许控制。原生解析搜索命中两条，不涉及用户凭据、真实会话正文或云模型调用。此记录不等同于桌面人工视觉验收。


验证结果：`pnpm test` 完整配置矩阵通过（包含 app-shell 119 文件/579 测试、CLI 和 crash matrix、Tauri Rust 边界）；app-core 最新完整回归 54 文件/321 测试通过；启用真实网关的 driver 回归 18 文件/97 测试通过；PI Agent 全量 `sync-fault-injection` 串行矩阵通过（初次并行的既有恢复测试出现锁冲突，单独及串行均通过）。docs/styles/architecture/typecheck、driver/common/ui-common/llm-ui/Web/Tauri 前端构建通过。新增命中定位 UI 回归、目录遮蔽/只读/换行路径/多行查询/链接/private home/revision/目录替换边界通过。改动保留在主仓及两个子模块工作树，尚未提交或推送。

最终增量复验：状态/控制 25 项、管理/收藏/搜索 14 项通过；原生断线证据不会被空事件页清除，旧事件不会覆盖较新列表；归档收藏保留只读路由。带附加远程挂载的本地项目通过授权 VFS 视图搜索，不误调用不存在的服务端根项目。


## 10. 继续实施记录（2026-10-09）

本轮补齐 Codex 原生重命名、归档及恢复归档。标题栏和侧栏按 capability 显示操作；服务端使用 thread/name/set、thread/archive、thread/unarchive，要求可写授权及原生 cwd 核验。归档只允许当前实例持有且明确 idle 的会话，释放控制所有权；恢复不 resume、不发送 turn、不获取所有权。管理操作沿用 epoch/requestId/receipt，未知结果只核对回执。侧栏提交前保存并释放已打开编辑器，避免两个 journal 的 CAS 版本冲突；完成后重新打开。已有远程收藏按完整身份更新标题和归档路由，更新失败明确原生修改已提交，不自动重试原生操作。未实现永久删除。

新增原生 text/image 附件能力及端到端发送：最多 5 个，UTF-8 文本每个 64 KiB、PNG/JPEG/WebP 图片解码每个 256 KiB、编码内容合计 512 KiB。浏览器、driver 及服务端执行容量/类型校验；服务端核验图片签名，不接受远程 URL 或宿主路径。MCP 请求 JSON body 上限单独调至 2 MiB，其余 JSON 路由保持 512 KiB；真实网关测试覆盖 5 个换行文本附件产生的大于 512 KiB 合法请求。未发送附件随草稿以 CAS 保存及恢复；已提交 turn 的草稿清除与回执确认一起保存，失败保留待核对回执，禁止重发；确认后清除提交的附件并保留后续文字编辑。

共享观察记录新增 title/archived/fileVersion。标题通知更新侧栏与标签；fileChange 完成、turn 完成和重连快照修复推进版本，由宿主合并刷新项目目录；普通文本 delta 不刷新。隐藏工作台释放订阅，显示后复用版本去重。独立 CLI 没有实时文件 watcher，外部 turn 的实时运行状态仍不可承诺。

真实已安装 Codex 使用临时 home 与本地确定性 Responses 服务验证：文本及有效 PNG 进入原生模型请求，受控会话 active → idle 且 owned=true；原生标题修改成功，归档 archived=true/owned=false，恢复 archived=false/owned=false。独立 CLI 正常退出且可读、notLoaded/owned=false，原生搜索命中两条。不涉及个人会话、凭据或云模型，也不代替桌面人工视觉验收。

验收：`pnpm test` 完整配置矩阵通过（本轮 app-shell 119 文件/582 测试及 30 skipped，包含 CLI crash matrix 与 Tauri Rust 边界）；最终 app-core 全量 55 文件/324 测试通过；开启真实网关的 driver 全量 18 文件/105 测试通过。PI Agent 全量 `sync-fault-injection` 串行测试通过。最终宿主专项 3 文件/30 测试通过，覆盖附件/回执恢复、标题管理、项目工作台、观察共享与文件版本去重。全仓 typecheck、docs/styles/architecture、common/driver/ui-common/llm-ui 及 Web/Tauri 前端构建通过；docs 保留 5 条既有历史表述告警，构建保留既有 chunk 容量提示。

剩余范围：其他 harness（已询问 Claude Code 或 DeepSeek CLI 的优先级，尚未收到选择）、独立 CLI 实时文件观察、原生永久删除、执行参数能力与 VMM。当前其他 harness 不声明虚假可执行能力。主仓与两个子模块的改动仍未提交或推送。


## 11. Claude Code 与项目目录 watcher 实施记录（2026-10-09）

已新增内置 Claude Code harness（kind=claude），使用独立的 Agent SDK stream-json 控制协议，不把 Claude 当作 Codex app-server。显式 command/home（CLAUDE_CONFIG_DIR），每个受控会话独立子进程，最多 16 个；项目实例复用 ProjectRuntime/ProjectLauncher/Bubblewrap 的目录、mount 和网络授权。支持原生 create/resume/history/search、文本/图片、增量输出、中断、工具审批和 AskUserQuestion。turn 以相同原生 user UUID 的 replay 确认提交，未知结果不重放；工具结果缺少 UUID 不会断开进程。审批 cancel 和显式 interrupt 记录 cancelled。进程断线仅影响对应 thread，关闭回收进程组及残留审批；阻塞 stdin 写入可随关闭取消。

原生 projects JSONL 只读、按实际 cwd/sessionId 授权，拒绝链接、目录逃逸及记录中途混入的外部 cwd。目录元信息扫描有 2048 个目录名称、8192 个文件、16 MiB/5 秒预算；历史每页最多 100 项/2 MiB，较早 cursor 无重复，用户 UUID 定义真实轮次，多条 assistant 保留同一身份。恢复前逐记录核验整份原生日志及文件身份，上限 16 MiB；以原生日志绝对路径恢复，兼容独立 CLI 宿主 cwd 与项目沙箱虚拟 cwd 的差异，并保留原生 session ID。没有写本地会话副本或修改原生索引。新建空会话在首条消息持久化前不保证重启后可发现；result 与 JSONL 落盘可能存在短暂延迟，后续刷新读取新历史。Claude 未声明 fork/rename/archive/unarchive。

已新增 project_watch/project_unwatch 和 fileWatch 发现能力。服务端有界 inotify 覆盖 pinned 项目根及附加 mounts，不跟随链接，不扫描隐藏、私有 home 或遮蔽目录；新目录、目录移动/删除及队列溢出重扫，溢出报告 gap。返回私有 token 和版本，不暴露宿主路径、文件名或正文；前后核验 owner/project/revision、目录身份。最多 16 个观察，空闲 60 秒后在后续请求清理；扫描最多 2048 个目录、50000 项、2 秒，部分覆盖标记 truncated，driver 每 30 秒补充刷新。客户端 close、项目配置变更及 forget 释放观察。共享观察在没有会话时仍通知目录变化，宿主使用既有版本合并刷新项目树；旧服务不发送未声明的 watcher 工具。

真实已安装 Claude Code 2.1.209 使用临时 home/项目和本地 Anthropic 协议 peer 验证：create → 原生 Write 审批 → accept → 沙箱文件写入 → idle/owned=true；原生历史可读；有效 PNG 进入原生模型请求；独立 CLI 正常退出、可发现且 notLoaded/owned=false；显式恢复保持原生 ID、获取新受控进程所有权并继续发送；外部目录写入推进 watcher 版本。可复验脚本为 tools/pi-agent/tests/real_claude.py。不涉及个人会话、凭据或云模型调用，不代替桌面人工视觉验收。

验收：开启真实网关的 driver 全量 18 文件/108 测试通过；Rust sync-fault-injection 全量串行测试通过；最终新增边界覆盖 Claude 原生协议/分页/foreign cwd、watcher mount/遮蔽/private/link/new-directory/owner/revision/根替换。全仓 typecheck、docs/styles/architecture、driver/Web/Tauri 前端构建通过；docs 保留 5 条既有历史表述告警，前端构建保留既有 chunk 容量提示。完整 `pnpm test` 矩阵通过：app-core 55 文件/325 测试、app-shell 120 文件/584 测试（另 3 文件/30 测试 skipped）、CLI 常规 36 文件/197 测试、crash matrix 22 测试及 Tauri Rust 边界。最终真实 MCP 目录观察链复验通过。

剩余范围：DeepSeek CLI 需要指定具体实现后适配；原生永久删除、执行参数能力及 VMM 尚未实施。文件 watcher 不提供独立 CLI 的实时执行状态，也不接管其控制；外部会话仍显示未知。主仓与两个子模块改动未提交或推送。


## 12. 提交记录（2026-10-09）

第 9–11 节的实现、测试及文档已提交。PI Agent 子模块提交 `e822911`（feat(harness): add Claude Code, native management and project observation）；piagent-driver 子模块提交 `feb5e0d`（feat(harness): add shared observation, search and native session controls）。主仓提交包含应用侧状态观察、项目检索、收藏/管理/导出/家族导航、附件草稿及两个子模块引用。此前“未提交”的说明为当时的交接快照；本次仅创建本地提交，未推送。

## 13. 原生永久删除、归档入口与合并搜索（2026-10-09）

Codex 新增 `harness_delete` / capability.delete，调用原生 `thread/delete` 删除历史和关联元数据，项目文件保留。允许受控且明确 idle 的会话，或已归档且 notLoaded 的会话；运行中和未归档的外部未知会话拒绝永久删除。原生操作会级联派生子会话，提交前对 active/archived 两组 ancestorThreadId 列表进行有界授权与状态核验，禁止跨项目删除；无法完整核验时拒绝。客户端沿用 epoch/requestId/receipt，持久化删除标记，恢复时先核对删除回执，不读取已删除历史、不重放删除。提交后按完整远程身份清理对应收藏并关闭被删除会话标签。Claude Code 尚无对应原生管理协议，不声明删除或归档能力。

修复工作台未加载 Codex 会话没有归档入口：允许不接管会话而归档 notLoaded 原生历史；外部执行状态仍不可见，确认框说明归档不会停止独立 CLI。受控运行中会话显示禁用的归档菜单。归档同样核验派生会话授权，恢复归档仍不 resume、不发送 turn。没有新增自动归档或定期删除的全局设置。

搜索共用原有侧栏输入框，默认筛选已加载树；有查询时才显示范围选项，可切换文件路径、文件正文、原生标题、原生正文和归档范围。清空查询收起选项及结果，保留取消、去抖、过期响应丢弃和命中导航。

原生 idle 显示“就绪”，active/审批/输入请求显示工作或对应等待状态；notLoaded 保持 execution=unknown，明确显示“未加载 · 外部运行状态不可见”，不能用历史末条消息推断当前执行。补齐“全部项目”视图的状态归属与订阅：沿节点的项目身份消费观察结果，对已加载远程会话所在项目建立有界订阅，避免只读当前选中项目、或同名 sessionId 串用状态。独立 CLI 和其他网关的实时执行状态仍未接入；用户报告当前会话仍全部 notLoaded，已询问其是在独立 CLI 运行还是在当前工作台发送，尚未取得该现场信息。不能把展示文案修正当作已获取外部实时状态。

验收：本机真实 Codex 在独立临时 home 下完成未加载历史归档→永久删除，原生列表与 read 均不可再读取，同一删除请求回执可核对；无模型调用或个人数据。Rust harness 12 项通过，覆盖外部派生会话拒绝删除/归档、运行中拒绝及回执去重。app-core 全量 55 文件/326 测试通过；driver 启用真实 MCP/Rust 网关的全量 18 文件/110 测试通过，最终管理/状态专项 47 项通过。app-shell 全量在沙箱外通过 121 文件/587 测试，另 3 文件/30 测试 skipped；随后新增全部项目状态归属回归及工作台专项复验通过。全仓 typecheck、docs/styles/architecture 通过；common/ui-common/driver/Web 构建和服务端构建通过。docs 保留 5 条既有历史告警，Web 保留既有 chunk 提示。未完成桌面人工视觉验收，也未重启用户正在运行的服务；本轮改动未提交或推送。

剩余范围：独立 CLI/其他客户端的可信实时执行状态来源；Claude Code 原生归档/永久删除能力；指定具体 DeepSeek CLI 实现后的适配；执行参数能力与 VMM。自动归档/清理策略尚未实现，需另行定义保留范围与条件。

## 14. 会话更新时间提示（2026-10-09）

工作台侧栏、会话标签与编辑器共用状态展示。优先显示原生 ready、运行、等待确认/输入等观测状态；unknown/notLoaded 的在线会话使用原生毫秒更新时间：2 分钟内（含边界）显示“近期活跃（推测）”，之后显示“最近更新于…”。缺失或无效时间保留原提示；未来时间不推测活跃。离线及原生错误优先，tooltip 明确更新时间不能确认执行状态。推测保持静态未知图标，不改 execution、所有权、归档/删除/停止权限。

driver 的共享 observation 携带原生 updatedAt，未取得观察快照的树节点使用原生 modifiedAt 投影。侧栏和标签共用一个到期定时器，即使服务端没有新事件也会刷新；隐藏工作台、关闭标签及销毁释放相关期限/定时器。编辑器复用现有每秒轮询，不新增原生 API 请求。

验收：app-shell 全量 121 文件/591 测试通过（3 文件/30 测试既有跳过）；driver 会话与状态专项 38 测试通过。app-shell、ui-common、llm-ui、driver 类型检查，common/ui-common/driver 库构建及 Web 构建通过；docs 检查通过，保留 5 条既有历史表述告警。新增测试覆盖精确 2 分钟边界、过期自动刷新、原生状态优先、无效/未来时间、树节点回退及隐藏/销毁释放；主仓和子模块仍未提交或推送。

## 15. 数字分身设计提案（2026-10-09）

新增 [数字分身设计](doc/design/digital-twin.md)，定义数字分身导航、画像与记忆、目标及来源设置、Pot 与 Agent 边界、授权及私密处理、mtime/revision/hash 增量分析、来源清单与删除核对、证据关联和遗忘、长 Session 分块及恢复状态。第一期为一个分身管家 Pot、手动来源选择、增量提取、人工确认及删除联动；自动触发、真实邮箱和专用 Pot 分阶段扩展，向量检索继续延期。该文档为提案，尚未实施数字分身功能。

## 16. 项目导航与目录加载修复（2026-10-09）

点击侧栏项目根显式更新项目范围，不再沿用上次项目；已打开的目录标签复用时也应用本次范围选择。项目选择器不再先等待完整侧栏展开才打开正文。已知项目范围立即从现有目录清单更新，文件及会话子项保留既有范围语义。

目录正文直接读取目录条目，移除正文前的侧栏展开；目录元数据读取并行，已知目录节点复用已有 stat。侧栏展开、项目导航及选中项在后台更新，过期请求不能覆盖新路由，后台同步期间的显式用户点击继续有效。

远程可用性探测移到目标标签内；离线保留所选远程资源路径及禁用提示。打开失败在目标标签显示原因，失败标签可再次打开重试，不隐式恢复本地项目；原编辑器保存失败仍保留原标签。项目文件和目录错误使用统一 pi-agent 结构化日志，包含时间、操作阶段、项目身份与错误码；不输出凭据或正文。诊断查询失败不替代原错误。

验收：app-shell 全量 121 文件/592 测试通过（3 文件/30 测试既有跳过），最终导航、目录创建及原生工作台专项 4 文件/10 测试通过；app-shell 类型检查及 Web 构建通过。docs 检查通过（114 份活文档，5 条既有历史表述告警）。测试覆盖真实侧栏项目点击、选择器切换、已打开标签复用、目录错误日志及重试、离线路由保留、正文先于阻塞导航完成、过期结果丢弃和只读创建限制。未做真实服务器手动视觉验收；改动仍未提交或推送。

## 17. 目录显示的 C4 分析与读取优化（2026-10-09）

[项目设计中的 C4 分析](doc/design/pi-agent-project-model.md#目录显示c4-组件与等待分析) 记录工作台、侧栏、目录投影、项目来源、忽略规则和 HTTP 服务的关系，以及优化前后各阶段等待。已知目录直接读取目录；未知深链识别目录后复用已取得的源视图和节点。`readFileDirectory` 共用一个文件视图与项目投影，并行查询节点、条目及投影；不再在目录头和列表之间重复读取收藏、打开视图或查询已知 stat。项目文件视图重用同次清单，仍校验项目重叠及授权。Session 文件根保留“文件”标题与正确父路由。

展示策略并行查询祖先 `.gitignore`，同次按路径去重，跳过独立类型查询，并使用原始字节读取；VFS 本身的文件类型与路径链接校验保留。每次目录读取重新获取规则，外部修改及删除不会被长期缓存遮蔽；规则读取止于 discovery root。失败及取消等待实际读取结束再释放视图，不提前关闭仍在使用的源。真实 VFS 回归比较原有过滤器，结果一致、底层 stat 调用减少。

piagent-driver 的 stat 批次按路径去重，重复祖先查询向 HTTP 只提交一份，再分发给各订阅者；保留每人独立的取消和期限，最后一个订阅者取消才中断共享请求，不跨批次缓存文件属性。

侧栏 `sessionSelected` 同时包含刷新事件，原流程可能在新页面打开时重新打开旧选中项。现在只在启动阶段用它恢复选中项，显式打开统一走 `resourceActivated`（点击与键盘），移除 `selectionSync` 及多处导航抑制逻辑。目录刷新返回条目后后台刷新侧栏，不再等待刷新或额外展开；目录创建动作使用真实来源投影的只读/禁用状态及现有行策略。

验收：app-core 全量 55 文件/329 测试通过；app-shell 全量 122 文件/596 测试通过（3 文件/30 测试既有跳过），随后补充真实 VFS 过滤请求比较；piagent-driver 全量 18 文件/115 测试通过（1 项 harness 网络测试需显式启用，既有跳过），包含真实 Rust 文件网络测试及批次去重/取消隔离。app-core、app-shell、driver 类型检查，架构边界、docs 检查、driver 与 Web 构建通过。完整测试限定 2 workers 以避免并行运行两个测试包时既有 IndexedDB 恢复用例达到 5 秒超时。首次连接探测、来源初始化及大目录分页仍需等待；未对用户真实服务器做网络耗时与桌面视觉验收，未重启运行中的服务，改动仍未提交或推送。
