# fs-agent：项目执行节点、目录同步与工作区

状态：设计规范，2026-09-29；已开始增量实施，实际完成范围与剩余工作见第 16 节。本文定义 HTTP 文件服务的增量演进，首版采用显式受信任宿主执行，后续通过独立适配器增加 sandbox。既有文件协议见 [HTTP VFS 设计](vfs-http-driver.md)，项目授权见 [Session 挂载边界](vfs-session-mount-access.md)。

## 1. 决策与范围

将现有 `itookit-vfs-server` 演进为 `fs-agent`，提供文件、同步、工作区和进程能力。仓库代码位于 `tools/fs-agent`，远端为 `mushuanli/fs-agent`；Cargo 包名、库名与二进制已统一为 `fs-agent` / `fs_agent`，release 产物为 `target/release/fs-agent`。

核心规则：

1. 一个项目只有一个执行节点；一个任务固定执行目标、PublishedInputRevision、WorkspaceId 和 AuthorizationRevision；私有工作区内容可变，以 WorkspaceGeneration 标识，不能把它称为不可变版本。
2. 远端项目只能直接挂载同一节点上的已授权目录。Web VFS、本地目录和其他节点目录先同步到目标节点，才能参与远端执行。
3. 同步负责生成完整副本；挂载负责装配已存在的目录；进程只消费准备完成的工作区，不隐式触发同步。
4. 任务内文件工具、Grep/Glob、Bash 使用同一个工作区。不得一边读浏览器 VFS，一边执行远端磁盘副本。
5. Agent 推理、工具定义、审批、Session 和 Kernel 仍在现有应用层；服务端不再实现一套 Agent 调度系统。
6. 普通文件请求保持独立操作；同步批次、工作区租约和进程各有自己的身份、状态和结束条件。
7. 首版不依赖 sandbox，但必须明确报告 `isolation = trusted-host`、`executionModel = trusted-cooperative-host`。导出路径约束、cwd、目录复制和进程组都不等于安全隔离。

首版不做自动双向同步、跨节点实时文件挂载、FUSE、任意插件工具执行、离线命令自动重放、完整 POSIX 文件镜像、TTY、跨服务器事务。流式输出属于非交互命令能力；交互终端随后独立加入。

## 2. 当前代码与演进位置

| 当前入口 | 可复用部分与调整 |
| --- | --- |
| [Rust 服务装配](../../tools/fs-agent/src/lib.rs) | 保留 `/v1/fs/*`、`/v1/exports`，新增能力发现与独立服务模块 |
| [HTTP VFS 驱动](../../packages/vfsdriver-http/src/index.ts) | 继续只实现文件语义，不加入 Bash 或同步策略 |
| [进程上下文](../../packages/app-core/src/vfs/session-process-context.ts) | `SessionProcessFactory` / `acquireSessionProcessContext` 已支持注入进程实现及先停进程后释放文件 |
| [工作区进程上下文](../../packages/app-core/src/vfs/workspace-process-context.ts) | 复用文件视图与进程授权版本一致性要求 |
| [运行时装配](../../packages/app-core/src/runtime/create-application-runtime.ts) | 当前有远程挂载即移除 Shell/TTY；改为显式执行目标解析，覆盖 Session 与 scope 两条路径 |
| [原生命令端口](../../packages/tools/src/core/types.ts) | HTTP 进程适配器实现 `INativeShell`，保留输出、超时和 AbortSignal |
| [终端端口](../../packages/llm-common/src/tty/tty-types.ts) | 后续适配 `ITTYDriver`；首版不宣告 PTY 能力 |
| [连接配置](../../packages/app-core/src/projects/remote-connections.ts) | 复用连接 ID、endpoint、credentialRef，文件连接增量获得执行能力 |
| [连接持久化](../../packages/app-core/src/projects/remote-mount-store.ts) | 保留 MindOS VFS `/etc/fs` 数据；凭据不复制到项目或同步清单 |

## 3. 分层与职责

```text
工作台 / Web / Tauri / CLI
  ├─ Session / Agent / Kernel / 工具授权与审批
  └─ app-core 项目执行策略
       ├─ 来源与同步关系
       ├─ 项目挂载与执行目标
       └─ 任务工作区获取 / 结果回传
            ├─ HttpFSBackend          文件
            ├─ SyncClient             清单与二进制上传
            └─ RemoteProcessDriver    命令与输出
                         │
                 agent-server
                   ├─ 身份 / 能力 / 资源归属
                   ├─ files           目录导出与文件协议
                   ├─ sync            增量传输与版本发布
                   ├─ workspaces      版本装配与租约
                   └─ processes       启动 / 输出 / 取消 / 回收
                         │
                   ExecutionBackend
                    ├─ TrustedHostBackend（首版）
                    └─ SandboxBackend（后续）
```

服务端提供执行机制，不决定项目应该何时同步、是否回传或哪一个 Agent 可以调用工具。客户端策略不能替代服务端身份、目录和执行权限检查。

服务端的能力发现、同步和进程协议共享 transport 机制；文件驱动不依赖同步策略，进程驱动不读取项目配置。认证、重定向限制、错误解码和 deadline 可从现有 transport 提取复用，禁止建立两套凭据管理。

## 4. 身份与数据模型

以下为建议契约，不是当前公开 API；字段在实施时按此语义定稿。

```ts
interface ExecutionTarget {
  connectionId: string;
  serverId: string;
}
interface DirectoryRef {
  serverId: string;
  directoryId: string;
}
interface ProjectExecutionBinding {
  target: ExecutionTarget;
  root: DirectoryRef;
  mounts: Array<{ at: string; source: DirectoryRef; access: 'ro' | 'rw' }>;
  authorizationRevision: string;
  mode: 'managed-copy' | 'direct';
}
interface SyncBinding {
  id: string;
  sourceId: string;
  sourcePath: string;
  target: ExecutionTarget;
  targetDirectoryId: string;
  direction: 'push';
  filterRevision: string;
  lastPublishedRevision?: string;
}
```

- `connectionId` 是 MindOS 配置身份；名称仅用于显示，不作为引用键。`serverId` 是服务安装的持久身份；重装或更换节点必须重新确认项目绑定，不能凭相同 URL 静默接管。
- `directoryId` 由服务端在授权域内解析为 export 内子目录或托管副本；查询、复用、去重和每次使用均校验身份与当前授权，ID 本身不是 bearer capability。客户端不能提交宿主绝对路径，也不能构造任意挂载设备或 sandbox 参数。
- 一个连接可绑定多个项目；目录按节点与服务端规范身份去重，同一路径复用项目。serverId 自报值不代替 TLS/凭据认证，也不作为跨用户授权依据。
- 项目引用其他项目时，解析并保存其目录身份，不复制 Session、凭据、工具授权，也不递归导入对方挂载。对方被移除后不自动删除底层目录，引用进入不可用状态。
- 主根和挂载必须属于同一 serverId；初版拒绝重叠挂载路径、挂载点冲突以及主根引用自身。不支持运行中修改布局。
- Web 内部项目仍可只有文件能力，没有 execution binding。所有项目不必强制拥有执行节点。

### 4.1 版本与实例术语

| 名称 | 语义 |
| --- | --- |
| SourceRevision / SourceBaseline | 来源的快照标识或逐路径基线；来源不支持快照时不能假定有单一强版本 |
| PublishedInputRevision | 已发布的完整输入清单与字节，不可变；依赖目录版本也在输入描述中固定 |
| WorkspaceId | 一次私有可变工作区实例的持久身份 |
| WorkspaceGeneration | 工作区文件写入或进程变更边界产生的单调代数，不等于文件 ETag，也不等于租约代数 |
| ResultRevision | sealing 成功生成的不可变结果清单与字节 |
| AuthorizationRevision | 创建/执行时核验的授权版本；授权变化撤销旧执行上下文 |
| LeaseGeneration | 控制权 fencing 代数，与工作区内容代数相互独立 |

```text
Source → SyncBatch → PublishedInputRevision
                            ↓ prepare
                         WorkspaceId + WorkspaceGeneration
                            ↓ Process → reconcile → seal
                         ResultRevision → ResultApplyOperation → Source
```

任务固定输入描述和 WorkspaceId；多个连续命令改变 WorkspaceGeneration，不能修改任务的输入基线。结果记录输入描述、命令与环境 profile、工作区代数及结果质量。

## 5. 两种目录工作方式

### 5.1 远端目录作为主数据

编辑器与文件工具通过 HTTP VFS 直接访问远端项目目录。无需先把同一目录下载再上传；同节点其他目录可以作为项目依赖。

`direct` 执行会直接影响该目录。鉴于现有强 revision 与文件 API 独占写入假设，**首版不开放可写 direct 命令执行**；已有 HTTP 文件项目继续正常读写，执行时通过 managed-copy 准备工作副本。未来 direct 模式必须单独完成并发写入、revision 和恢复契约，不能通过移除运行时 Shell 禁用判断提前开放。

### 5.2 Web / 本地目录作为主数据

用户显式同步到 agent-server 的托管目录，生成不可变版本；任务使用该版本的工作副本。运行结果保存为独立结果版本，由用户查看差异并选择回传。

初版默认手动同步，允许显式开启“执行前同步”；启动前同步失败就不执行，不自动退回旧副本。用户可以主动选择已有发布版本执行，UI 必须显示版本和来源已变更提示。

Web 同步通过已有 VFS 可读能力获取字节；同步任意宿主本地目录仍需宿主授权的文件接口、用户选择文件/目录或 Tauri/CLI。agent-server 不会使网页自动获得电脑上任意目录的读取权限。

## 6. 同节点挂载与工作区装配

同节点解决网络路径问题，并不意味着宿主操作系统已经具备虚拟挂载功能。分两层建模：

- `WorkspaceSpec` 描述主目录、挂载位置、访问意图和固定的 PublishedInputRevision。
- `ExecutionBackend.prepare()` 返回实际文件视图、执行 cwd 与路径映射；只有准备完成后才能启动。

首版 TrustedHostBackend 将选定主版本及依赖版本物化为独立目录树：根是实际 workspace 路径，附加目录复制到配置的相对位置。优先使用安全的文件克隆能力，缺失时复制；禁止把可修改工作副本硬链接到已发布版本。首版拒绝 symlink、特殊节点、不可表示的文件名；可执行位需要作为受限同步元数据保存，不复制 owner、setuid 或任意权限位。

VFS 的 `/workspace` 映射到实际目录。传给进程的是实际 cwd 与已解析的工具路径；不要对任意 shell 脚本文本做字符串替换。命令使用相对项目路径；首版不承诺任意脚本中的绝对 `/workspace` 路径可用，能力响应明确 `pathModel = host-mapped`。后续 sandbox 可提供 `pathModel = virtual-root`。

`ro` 挂载通过文件 API 拒绝写入；TrustedHostBackend 设置尽力只读权限，并在每次命令结束后用原始完整清单核对依赖内容、路径与可执行位，不能应用 ignore 后再校验。发现变更即报告 `WORKSPACE_POLICY_VIOLATION`，工作区进入 tainted，拒绝继续命令、正常 sealing 和结果回传。可保留标记 tainted 的诊断快照供查看/下载，但不能作为普通 ResultRevision 或后续任务输入。恢复需从固定输入新建工作区，不能靠清除标记继续执行。

权限位与事后核对不能证明依赖在执行期间从未被修改后恢复，亦不能阻止同执行身份主动修改副本。能力区分 `readOnlyEnforcement = best-effort` 与未来的 `kernel-enforced`。需要严格只读/目录隔离的项目必须要求对应 sandbox 保证，节点无法满足时拒绝执行；仅有 sandbox 名称也不能推导具体强制能力。

多个任务可共享不可变版本，但默认分别创建工作副本。同一工作副本首版只运行一个命令；不同任务按服务端配额并行。

## 7. 同步协议与提交边界

### 7.1 首版范围

按文件增量，直接传输二进制。清单项包括相对路径、节点类型、大小、SHA-256 摘要及可执行标志；目录用于保留空目录。mtime 可用于本地扫描优化，不能当作内容身份或强 revision。

不做块级差分、全局跨用户去重或双向监听。已有文件版本可以在同一授权域内复用，不能通过摘要接口探测其他用户文件是否存在。

过滤规则属于显式版本化配置；运行状态、凭据、同步暂存目录不自动进入同步。忽略规则改变后先计算计划，再决定删除，不能直接把所有未出现在新清单中的目标文件删除。

### 7.2 流程

```text
scan → prepare(baseRevision, manifest) → upload(missing files)
     → verify → publish(expectedTargetRevision) → publishedRevision
```

1. 客户端扫描来源，并保存本次清单与同步 ID；上传内容必须与声明摘要一致。
2. 服务端验证路径、身份、容量、文件数和目标版本，返回缺少的内容。
3. 上传写入同步批次暂存区；失败、断线和取消不会修改已发布目录。首版重试单文件传输，不要求断点续传。
4. `publish` 校验所有字节，按第 7.6 节合成下一 managed state，再构建完整版本，通过持久版本指针 CAS 发布。版本目录与指针存储位于服务管理的数据根；不把多文件原地覆盖描述为原子发布。
5. 只有成功发布并被工作区固定的 revision 可用于执行。响应丢失时查询同一 syncId，不创建新批次盲目重试发布。

来源扫描不是天然快照：上传期间检测到单文件变化必须重读或中止；最终复核清单，无法得到稳定视图时报 `SOURCE_CHANGED`。普通可变目录不能承诺严格的跨文件时间点快照；结果表示被验证的清单版本。要求严格快照的调用者需提供支持快照的来源，不能靠有限次扫描冒充。

同步目标必须是服务端专用托管副本，不能把任意用户目录当作镜像清空。删除只发生在新版本的受管理清单中，不影响旧版本和其他 export 文件。

### 7.3 状态与结束

```text
receiving → verifying → publishing → published
     └──────────→ aborted / failed
```

`published/aborted/failed` 是终态。`publishing` 期间取消与提交竞争，由服务端记录决定结果；已发布不回滚。未结束批次有 lease 与 TTL，过期停止接收并清理暂存内容；固定中的已发布版本不得回收。重启恢复发布日志与版本指针后再提供服务；无法判定则报告 unknown，不自动重复提交。

同步的 `prepare/publish/abort` 只作用于该批次，不扩展为通用 VFS begin/end/commit。

### 7.4 执行结果与回传

任务显式结束、所有命令退出且完成回收和只读依赖核验后，工作区进入 sealing，生成 ResultRevision 及相对于 PublishedInputRevision 的差异。tainted / unknown 工作区不得正常 seal 或回传。

回传检查来源当前内容与当初输入的基线，发生变化则报告冲突，允许逐文件选择，不默认覆盖。每个写入/删除使用来源支持的条件操作；不支持原子条件写的来源不得提供“安全自动回传”。跨文件回传没有通用事务时，显示已完成/失败列表并持久记录进度，不能宣称整体原子成功。

### 7.5 `.gitignore` 只影响界面展示

按最新要求，`.gitignore` 是客户端文件树的展示规则。工作台、VFS 文件浏览器在加载条目时隐藏匹配项；agent-server、原始 VFS `list/stat/read/write/remove`、同步扫描与同步发布均不解析、不自动应用 `.gitignore`。隐藏不等于删除或禁止访问，也不改变任务工作副本实际包含的文件。

规则匹配机制复用 [FileIgnoreFilter](../../packages/vfs-core/src/impl/services/file-ignore.ts)，由 vfs-ui 显式选择仅 `.gitignore`、无内置排除目录的策略。没有 `.gitignore` 时，不能仅凭 node_modules、dist、target 等名称隐藏它们；原有独立搜索工具的发现策略不由文件树设置隐式修改。

- 支持祖先与嵌套 `.gitignore`、否定规则、目录规则；规则限定在当前项目或独立挂载根内，不继承其他来源的规则。
- 过滤在 UI 数据加载/映射阶段执行，不仅用 CSS 隐藏；直接进入子目录也使用相同的祖先规则。
- 原始 API 完整返回授权条目；服务端没有 ignore 参数、匹配器或过滤分页 cursor。界面过滤远端分页时仍须按照原始 nextCursor 继续读，不能把一页可见项为空当成服务端目录结束。
- 创建/更新条目使用同一展示判断，修改、删除或重命名 `.gitignore` 时重新加载已展开分支。每次刷新重读规则，避免全局缓存导致规则过期。
- Session/任务等合成导航项不参与文件名匹配；只在实际文件来源上应用过滤。精确打开文件、导出、移动和删除的底层语义保持不变。
- ignore 读取失败显示加载错误，不能把失败伪装成目录为空。已有列表可保留至成功刷新；取消不得发布迟到结果。

同步如果需要排除文件，使用用户显式配置的同步 exclusions。filterRevision 只覆盖显式同步策略内容及其语义版本，不包含 `.gitignore`；修改 `.gitignore` 只改变 UI，不改变下一次同步计划。第 7.6 节的 retained 规则仅用于显式同步过滤条件变化。

验收覆盖：无规则不隐式排除、嵌套/否定、挂载边界、UI 隐藏但原始 list/read 仍可见、规则修改后刷新、读取错误、合成导航不受影响，以及服务端/同步计划不受 `.gitignore` 影响。

### 7.6 Managed state 与过滤转换

下一版本来自 `previous managed state + observed source manifest + filter transition plan`，不是直接用过滤后的清单替换旧清单。

| 先前状态 | 本次观察 | 下一状态 / 默认内容 |
| --- | --- | --- |
| 未管理 | 可见且存在 | new → managed，写入本次内容 |
| managed | 可见且存在 | 保留或 modified → managed，写入本次内容 |
| managed / ignored-retained | 被当前规则排除 | ignored-retained，继承上一发布版本内容 |
| ignored-retained | 再次可见且存在 | modified 或 unchanged → managed，使用重新校验的来源内容 |
| 已管理 | 完整扫描确认可见但来源不存在 | pending-delete，确认计划后才从下一版本删除 |
| 未管理 | 被忽略 | absent，不进入 managed set 或新版本 |

只有显式 cleanup 计划可以把 ignored-retained 转为 deleted。被忽略目录未遍历、列举失败、权限不足、取消和 SOURCE_CHANGED 都不能推断成来源删除。既有路径在过滤范围外时，即使物理来源已经不存在，也先按 ignored-retained 保留，直到恢复可见或显式清理。

此前从未纳入 managed set 的 ignored 项不进入新版本；此前已管理、此次被忽略的项必须出现在下一版本清单中，引用原有字节并标记 ignored-retained。准备请求返回新增/修改/保留/待删摘要，publish 绑定已确认计划摘要、filterRevision 和 expectedTargetRevision；基线变化必须重算，不能悄悄扩大删除集。未确认的 pending-delete 继承旧内容；原始来源基线与继承内容的来源分别记录，回传不得把 ignored-retained 当成此次来源快照。

例：R10 有 a/b，随后显式同步规则忽略 b，则 R11 仍有 a/b，b 标记 ignored-retained；从零创建的新镜像则只有 a。用户显式清理后 R12 才移除 b；R10/R11 的不可变字节不被原地删除。

### 7.7 结果回传操作与版本回收

`ResultApplyOperation` 是 A3 的一等资源，含 applyId、所有者、来源身份、ResultRevision、基线、确认计划摘要、逐路径前置条件和执行回执。协调记录由持有来源写端口的 app-core 适配器持久保存；服务端不因提供结果而自动取得 Web VFS 写权限。

状态为 planned / applying / partial / completed / cancelled / unknown。每个文件在写入前登记意图，完成后保存来源的新 revision；取消保留已完成项。响应丢失后先读回执并核对来源，无法区分是否成功的写入标记 unknown，不能只凭本地进度为空就重放。来源支持幂等操作 ID 时透传 applyId + entryId；不支持时保留条件写与人工核对路径，不承诺 exactly-once。

版本 GC roots 明确为：当前 published pointer、活动 sync 的基线与暂存引用、未释放 workspace 的输入/依赖、保留的 ResultRevision、未终结 apply 的输入/结果、显式 pin，以及 sealing_failed / tainted / unknown 隔离记录。结果的普通保留期到期后解除其保留根；进行中的回传或显式 pin 仍阻止回收。

固定引用与版本发布/工作区创建在持久事务中提交；GC 在删除前原子核验无引用并标记 deleting，随后拒绝新 pin，避免扫描与新使用竞争。共享内容仅在所有清单引用解除后删除。GC 不受界面 `.gitignore` 规则影响，也不能为了满足磁盘配额删除活动或待核对工作区。

## 8. 命令执行协议

建议新增协议入口（路径为提案）：

| 入口 | 作用 |
| --- | --- |
| `GET /v1/capabilities` | 协议版本、serverId、机制能力、isolation、executionModel、pathModel、限额 |
| `POST /v1/directories/resolve` | 将被授权的 export + 相对路径解析为目录身份 |
| `POST /v1/syncs` | 建立同步批次与校验清单 |
| `PUT /v1/syncs/:id/files/:fileId` | 上传清单中的原始文件字节 |
| `GET /v1/syncs/:id` | 缺少内容、状态、发布结果 |
| `POST /v1/syncs/:id/publish` / `abort` | 发布或取消批次 |
| `POST /v1/workspaces` | 根据固定目录版本及授权准备工作区 |
| `GET /v1/workspaces/:id` | 工作区状态、文件访问句柄和结果 revision |
| `POST /v1/workspaces/:id/renew` / `release` | 续租或有序释放 |
| `POST /v1/workspaces/:id/processes` | 启动非交互命令 |
| `GET /v1/processes/:id` | 查询状态、退出码、服务端 epoch |
| `GET /v1/processes/:id/output?after=` | 顺序输出流，可断线后续读 |
| `POST /v1/processes/:id/cancel` | 请求停止并追踪回收 |

工作区文件访问复用文件协议语义，但使用服务端签发的受限工作区句柄，独立于管理员配置的 export。句柄必须绑定身份与租约，不能凭知道 ID 即可访问；可新增 `/v1/workspaces/:id/fs/*` 路由，HTTP 文件驱动通过明确的 endpoint scope 适配。

命令参数包括 `command/args/cwd/timeoutMs/requestId` 及当前 WorkspaceHandle；cwd 是工作区内相对路径。环境变量使用服务端定义的配置 profile，首版不允许客户端任意覆盖启动器、宿主凭据和隔离配置。Bash 工具通过允许的 shell 显式执行脚本，服务端不会把普通 args 自动拼成 shell 命令。

客户端生成 requestId 并在发送前持久保存；服务端以授权域、身份、工作区和 requestId 登记启动意图。规范指纹包含 command/args/cwd、固定环境 profile revision、解析后的 executable 身份、输入版本与授权版本；超时预算在首次接收时固定，重试不能延长。环境 profile 不得在同一 requestId 下静默更新。相同 ID + 相同规范命令描述返回原执行状态，不再次启动；不同描述冲突。登记和 OS 启动之间存在崩溃窗口，不能承诺 exactly-once；无法判定是否已启动必须返回 unknown，人工核对，禁止自动重发。

实际启动前以受控 PATH 解析可执行文件并记录解析路径、可获取的文件身份及 profile revision；首版不承诺工具链字节不可变或执行完全可复现。服务端响应报告这一限制。

输出按单调序号携带 stdout/stderr 字节帧、退出事件及截断信息，浏览器可通过认证 fetch 消费流。服务端使用有界磁盘缓冲，慢客户端不能无限占内存；超过保留窗口返回明确 gap。stdout/stderr 各自保序，交错顺序只代表服务端观测顺序。首版不用携带凭据的 URL 或依赖浏览器 EventSource 的认证限制。stdout/stderr 有明确容量和 TTL；终态、退出码、取消原因与 requestId 去重回执独立持久保存，至少覆盖工作区与所有关联回传操作的生命周期且不短于输出 TTL。回执过期的旧 ID 返回 expired/unknown，不作为新请求重新启动。

## 9. 生命周期、取消与恢复

进程状态：`accepted → starting → running → exited`；取消为 `cancelling → cancelled`，启动失败为 `failed`，丢失可确认状态为 `unknown`。退出码与取消原因单独保存，不把网络断线作为进程退出。

工作区状态：`preparing → ready → running → reconciling → ready` 支持连续独立命令；任务结束时由 ready 进入 `sealing → finished`。启动/准备失败为 failed；依赖变更为 tainted；无法确认进程或字节稳定为 unknown。回收状态 releasing/released 独立记录。finished 保留结果版本，released 释放活动资源，不等于删除结果。

sealing 失败进入 sealing_failed：保留原工作区、输入 pin 和已生成暂存结果，禁止新命令及文件写入。对同一 WorkspaceGeneration 使用同一 sealId 重试校验/发布，不重新运行命令。只有完整验证并原子登记 ResultRevision 后才能进入 finished；磁盘不足也不自动丢弃原工作区。用户明确放弃后才按回收流程清理。

- AbortSignal 停止等待并尽力发送 cancel；连接断开不证明 cancel 到达。
- 服务端 deadline 独立计时，取客户端剩余预算与服务端限额的较小值；重试不重置预算。
- cancel 对同一进程幂等，先温和停止，再按宽限期强制终止并等待回收。首版追踪进程组及已知子进程，但不承诺能约束主动脱离管理的进程。
- workspace release 必须先停止并回收进程，随后释放文件视图，最后清理工作目录；失败保持 releasing 并允许重试。
- 控制通道、cancel 和租约维护不得与文件上传共用一个可能耗尽的工作槽。
- 执行时续租；浏览器关闭后按明确 lease 期限停止任务并回收，不能依赖网页 unload 通知。长任务跨浏览器离线继续运行不在首版范围。
- 服务重启后变更 runtime epoch，恢复持久请求与结果；PID 不能单独作为身份，不能盲目杀死被复用的 PID。不能确认已回收的工作区隔离为 unknown，不重新执行或直接删除。

连续命令只共享显式 workspaceId；每次 exec 是独立进程，不保留前一进程的 cd、变量或 shell 状态。交互 shell 后续以独立 terminalId 提供，必须定义 close/expiry。不同资源的 ID 不互相替代。

### 9.1 Workspace lease 与 fencing

```ts
interface WorkspaceHandle {
  workspaceId: string;
  leaseId: string;          // Opaque token, redacted from logs and URLs.
  leaseGeneration: number; // Durable monotonic fencing generation.
}
```

所有者是授权域中的 principal + ownerInstanceId，服务端保存 token 校验值、代数、expiry、AuthorizationRevision 和 runtime epoch。ID/token 均不能代替请求认证。viewer 仅能使用单独授予的状态/输出读取权限，不持有续租、启动、取消或 release 权限。

首版不复活过期工作区：续租只能延长尚未过期、未撤销的当前 lease；到期原子标记 revoking，拒绝新的执行与文件操作，并启动停止/回收。需要重新执行时创建新 WorkspaceId。有效期内明确移交控制权可原子轮换 owner、leaseId 和 leaseGeneration；不能因同用户另一 tab 连接就自动接管。移交不重新启动已经登记的进程。

renew/release/spawn/cancel、工作区文件操作、seal 及控制权移交都携带当前 handle。服务端在共享生命周期锁下检查身份、token、代数、expiry 和授权版本；错误返回 STALE_LEASE，旧请求不得产生副作用。流式上传先暂存，在实际发布文件时再次核验 handle；锁和重新校验共同保证异步 I/O 不能绕过 fencing。

已接受的进程属于 workspace 的持久执行记录；轮换只改变控制权，不遗弃旧 generation 下已运行的进程。旧 owner 后续取消/释放被拒，当前 owner 或服务端回收器可管理该进程。到期回收器也带期望 generation 做 CAS，旧计时器不能终止新 owner 的有效工作区。重启默认撤销活动 lease 并对账，不自动续期；unknown 工作区保留诊断和 pin。

## 10. 文件一致性与 CAS

现有文件服务的强 revision 依赖经服务端管理的写入。增加命令后，目录被进程直接修改，不能继续仅靠现有内存 generation 宣称严格 CAS。

首版采用以下收窄方案：

- 已发布同步版本不可变，标识来自完整清单；命令只能使用独立副本。
- 同一 workspace 中，文件工具与进程操作经服务端共享的调度门串行化。命令运行期间，工作区文件 API 返回 `WORKSPACE_BUSY`，不允许编辑器或另一任务并发修改；查看旧的已发布版本不受影响。
- 开始进程前失效工作区旧文件 revision 并进入 busy；只有合作型进程前提成立、受管成员回收、ro 核验与重建完成，才增加 WorkspaceGeneration、建立新的文件 revision 并恢复文件 API。sealing/reconciling/sealing_failed 期间同样禁止写入，避免校验时又出现写者。
- 在 trusted-host 模式，上述一致性明确依赖 cooperative-process assumption：命令及依赖不 daemonize、不主动脱离监管、不留下后台写者，且没有外部程序修改托管目录。正常 shell 可启动脱离监管的后台进程，原进程退出、进程组回收或扫描稳定均不能证明此前提。能力报告 `workspaceConsistency = cooperative`，不是对任意 Shell 的强 CAS 保证。
- trusted-host 仅用于管理员/用户明确接受的合作型执行策略；不能因为命令来自 Agent、已经审批或完成静态检查，就自动推导它合作可信。要求执行不受信任的 Agent 生成命令或证明无后台写者的项目必须要求 sandbox 与相应进程收容能力，首版不满足则拒绝。发现违反前提或观测不明时保持 unknown，禁止正常 sealing 或条件写入；没有检测到问题也不升级保证。
- 原有独占 export 不能同时被新增的 direct 命令通道写入。独占文件锁不约束普通子进程；watch、mtime+size 或仅在命令结束递增计数都不能代替此契约。

未来 sandbox 可以强化“只有受管进程能写工作区”的前提，但不能自动把跨文件回传变成事务。

## 11. 能力、授权与界面

机制能力与当前可用状态分开：`files.read/files.write/sync.push/process.exec/terminal.pty` 表示支持的功能；`connecting/online/offline/degraded` 表示健康状态。`isolation/executionModel/workspaceConsistency/readOnlyEnforcement/pathModel` 描述执行保证，不用一个 tools=true 概括。

可用工具取交集：后端机制 ∩ 服务端身份/目录授权 ∩ 项目/Session 授权 ∩ Agent 授权。服务端在每次创建工作区、启动命令和访问资源时重新校验。授权 revision 变化使旧工作区失效并触发取消/回收；禁止在线把一个任务改派到其他节点。

| 场景 | 工作台行为 |
| --- | --- |
| Web 内部项目，无执行节点 | 文件工具可用；Bash/TTY 不提供给 Agent |
| 仅文件协议的旧服务 | 正常远程文件项目，执行能力显示“不支持” |
| 文件在线，执行服务不可用 | 文件可用，只禁用命令相关操作 |
| 同步未完成/失败 | 展示状态与重试，不静默执行旧版本 |
| 远端离线 | 禁用文件入口、新会话和新的远端执行；已有 Session 仍可打开查看 |
| 当前已有运行任务断线 | 显示连接中断、执行状态待确认，恢复后查询原 ID |
| 项目要求 sandbox，节点仅 trusted-host | 展示能力不满足，拒绝启动 |

设置沿用“文件系统”中的多连接管理，增加服务类型/能力与执行模式信息；连接配置可统一显示为“远程服务”，不创建平行的文件服务与执行服务密码列表。保留编辑时未修改 password 则复用原口令的行为。

项目设置显示执行节点、主目录、同节点引用、同步来源、已发布版本和回传状态。选择挂载时只列出该节点可用目录；选择其他来源时明确进入同步配置。远端项目不因挂载另一个项目而取得额外执行授权。

现有配置留在 MindOS VFS `/etc/fs`，增量保存执行绑定与同步配置；运行回执置于 `/var/lib` 对应业务目录。均不是宿主系统绝对目录。server 数据根单独由管理员配置，保存版本、暂存、工作区和日志。

## 12. Sandbox 演进端口

建议服务端内部抽象：

```rust
// Proposed responsibilities, not compiled public API.
trait ExecutionBackend {
    async fn prepare(&self, spec: ValidatedWorkspaceSpec) -> PreparedWorkspace;
    async fn spawn(&self, workspace: WorkspaceHandle, spec: ValidatedProcessSpec) -> ProcessHandle;
    async fn terminate(&self, process: ProcessHandle, policy: StopPolicy) -> StopResult;
    async fn release(&self, workspace: WorkspaceHandle) -> ReleaseResult;
}
```

首版 TrustedHostBackend 负责目录物化、路径映射、受管进程和有序回收。后续 SandboxBackend 负责隔离环境、只读挂载、网络/环境变量策略与资源限制。具体 sandbox 技术另行评审，不在本设计提前承诺 Linux/macOS/Windows 同等隔离能力。

项目策略提出所需保证，例如 `requiredIsolation = sandbox`、网络策略和目录写权限；实际能力由后端报告并验证。沙箱策略由服务端配置选择，不接受 Agent 任意指定宿主挂载路径或低层运行参数。增设 sandbox 不改变同步、进程 ID、取消及工具接口。

### 12.1 TrustedHostBackend 最低运行基线

服务 daemon 身份与命令执行身份分离。命令必须使用显式配置的专用非特权 OS 用户，不继承 daemon 的 UID/GID/附加组权限；不能以 root 或 daemon 身份降级执行。执行用户仅获得私有工作区和必要运行目录的权限，不应能读取服务凭据、版本仓库、启动回执或其他授权域的工作区。部署无法满足身份切换与目录权限时，只提供 files-only 并报告执行不可用；不为了启用执行把整个服务长期提升为 root，启动器/降权适配单独审查。

进程环境从空白 allowlist 构建：受控 PATH、工作区专用 HOME/TMPDIR、受限 umask、经过验证的 cwd、固定 env profile；不合并 daemon 环境，尤其不继承认证、云服务、代理或 SSH 凭据。关闭不需要的继承文件描述符，仅传入明确的 stdin/stdout/stderr；身份切换必须处理附加组等残留权限。

最低限额包括命令墙钟时间、并发进程槽、输出字节/保留期、上传与工作区存储配额、受支持的进程/文件描述符限制。CPU/内存/磁盘/子进程限制逐项报告 `enforced`、`monitored` 或 `unsupported`；监控后停止不等于硬上限，单进程限制也不能冒充整个进程树限制。无法满足项目必需限额时拒绝执行。

上述措施降低宿主执行影响范围，不是 sandbox。同一执行身份、可访问网络与宿主资源仍属于合作型假设，不能为不同不可信租户宣称安全隔离。后续 sandbox 才提供经验证的工作区边界和进程树收容。

trusted-host 必须由管理员显式开启 `process.exec`；旧文件配置升级后默认仍是 files-only。认证继续限制文件/进程资源归属；即使 shell 具备宿主权限，也不能因此在协议层跳过授权。凭据不得写入命令、日志或同步清单。

## 13. 目录结构与公共出口

建议实施后的结构，以下路径尚未创建：

```text
tools/fs-agent/src/
  config/                 服务配置、身份、授权与限额
  http/                   路由、协议 DTO、错误和认证
  files/                  现有受限文件机制
  sync/                   清单、上传、版本发布与恢复
  workspaces/             布局、租约、目录版本固定与回收
  processes/              请求登记、输出、状态与取消
  execution/              ExecutionBackend 端口
    trusted_host/         首版实现
  storage/                发布日志、执行回执、版本与配额
packages/agent-client/src/
  protocol/               版本化 DTO 与错误类型
  transport/              认证 HTTP、deadline、输出帧
  sync/                   传输机制
  processes/              INativeShell 适配
packages/app-core/src/projects/
  execution/              目标解析、有效能力、工作区策略
  sync/                   来源选择、同步计划、回传冲突策略
packages/app-shell/src/projects/
  execution/              节点与能力展示
  sync/                   同步状态、差异与冲突交互
```

仅增加实际需要的模块；不预建空 sandbox 实现。`agent-client` 不依赖 app-core、DOM 或项目布局，只导出客户端端口与必要 DTO。app-core 不依赖具体 HTTP 实现，通过运行时注入；平台宿主负责装配 Web/Tauri/CLI transport。现有 vfsdriver-http 保持独立可用，公共 transport 提取时不得倒置依赖。

## 14. 实施阶段与验收

### A0：能力与执行目标

增加服务能力发现、稳定节点身份、项目执行绑定及有效能力解析。旧服务 404 capabilities 时按 files-only 兼容；其他认证/网络错误不得当成不支持。替换“有远程挂载就禁用全部进程”的分支，同时覆盖 Session 与 scope；未配置执行节点仍禁止远程项目落到宿主 Shell。

验收：同一 Web 工作台中不同项目能力独立；离线仍可看已有 Session；Agent 工具列表与服务端拒绝行为一致；旧服务无改动可接入。

### A1：非交互进程与托管工作区

实现合作型受信任后端、独立执行身份、同节点目录副本、固定输入与可变工作区视图、执行输出、取消、带 fencing 的 lease、回收和状态查询。先通过 CLI 验证，再接 Web/Tauri 的同一端口。阶段内不开放 direct 写入和 PTY。

工程可拆为 A1.0（工作区、命令、状态、有界输出、取消、release）和 A1.1（完整重启对账、输出重放、控制权恢复体验）。但启动意图持久登记、lease fencing、重启后拒绝旧句柄及 unknown 不重放必须从 A1.0 起存在；A1.0 可在恢复未完成时拒绝执行，不能把重复启动风险留给下一阶段。

验收：工具与 Bash 读取相同字节；路径映射明确；同一工作区命令期间文件操作被拒；断线不重复执行；超时和释放有序；重启未知结果不伪装成功；共享连接的一个项目释放不影响其他项目；旧 lease/旧计时器不能释放新 owner；daemon 环境 secret 不出现在进程环境；ro 变更产生 tainted 而非正常结果；sealing 失败可重试且不重跑命令。

### A2：Web VFS → 远端同步

实现清单扫描、缺失文件上传、完整版本发布、手动/执行前同步、同步取消和重启恢复。支持单个来源生成主副本及同节点依赖副本；不需要先实现自动回传。

验收：二进制不经 base64；未变化文件不重传；变化来源报告冲突；发布前断线不暴露半目录；目标版本竞争 CAS 失败；跨用户摘要探测被拒；配额生效；暂存回收不删除固定版本。

### A3：结果差异与显式回传

实现结果版本、基线比较、逐文件冲突决策和回传进度恢复；只对具备条件写入的来源开放安全回传。其他来源先支持下载/导出结果。

验收：远端结果不能覆盖本地新修改；删除仅作用于确认的受管理路径；中途失败显示部分完成；再次恢复不会静默重放已失去前置条件的写入。

### B：Sandbox 与交互终端

在 ExecutionBackend 处增加 sandbox，实现严格目录/网络/资源保证；PTY 单独扩展协议及 ITTYDriver。两个能力分别发现、授权和测试，不能以支持 exec 推导支持终端或隔离。

全阶段故障测试覆盖：上传/发布崩溃窗口、请求登记/进程启动窗口、退出/回收窗口、授权撤销、断网、磁盘耗尽、输出超限、租约过期与 PID 复用。性能基准分别测目录扫描、增量上传量、工作区物化成本、首字节输出延迟与取消回收时间，不用单一吞吐数字掩盖工作区复制开销。

## 15. 本轮评审结论

五项 P0 均采纳：原始 VFS 与界面展示策略分层（后续用户明确 `.gitignore` 仅用于 UI）；managed mirror 明确 ignored-retained；trusted-host 明确合作型假设；独立低权限执行身份与环境清洗；租约增加 owner/token/generation fencing。同步补齐版本术语、ro 违规结果、apply 身份、版本 GC roots 与 sealing 失败恢复。

两项收窄：不把进程组或低权限用户称为 sandbox；A1 内部可分步交付恢复体验，但不能延期启动登记与 unknown/fencing 基础契约。本文没有新增自动双向同步、direct 写入或 PTY 范围。新增契约通过上述 A0—A3 验收实施，不意味着功能已经实现。

## 16. 实施记录（2026-09-29）

当前是增量实施状态，不表示 A0—A3 已全部交付：

- Rust 已提供认证的 `/v1/capabilities`；可通过配置 `server_id` 固定安装身份。旧配置仍可启动且身份为 null，不能绑定执行目标。尚未具备的 sync/exec/PTY 返回 false。
- HTTP provider 已接入能力查询；仅 capabilities HTTP 404 才尝试旧 exports，认证、网络与格式错误不降级为“仅文件”。
- app-core 提供 `ProjectExecutionService`，将 managed-copy 目标写入 MindOS `/etc/fs/projects/<projectId>.seq` 的 execution 记录；校验节点身份、当前目录授权与隔离要求，通过注入端口获取一致的文件/进程工作区。Session/scope 两条路径均已接线，默认仍不开放远程 Shell。
- 项目执行模块通过 contracts 定义存储、来源与工作区端口；policy 负责授权摘要和能力裁剪，service 编排生命周期，store 负责 seqfile CAS。授权版本采用稳定 SHA-256 摘要，获取工作区后再次验证授权。
- Rust workspaces 将租约模型、生命周期与原子日志分别放在 lease_model、leases、lease_journal 中；已实现持久 owner/token-hash/generation、幂等释放、显式移交、过期撤销与重启 unknown。短同步提交通过 `with_current` 持有 fencing 锁，单独 validate 不能保护后续副作用；日志持久化失败后拒绝继续使用该 registry。目前尚未连接工作区/进程 HTTP 路由，不宣称可执行命令。
- Cargo package 和可执行产物统一为 `fs-agent`，Rust library 为 `fs_agent`；本地源码目录为 `tools/fs-agent`。
- `.gitignore` 已按最新要求接入 vfs-ui 与工作台文件展示，原始文件接口和服务端不处理它。过滤策略与已有工具发现策略分开。

尚未交付：工作区物化、专用执行身份启动器、远端进程及其输出/回收 HTTP 闭环、同步发布、结果回传、设置中的执行目标编辑界面。上述部分完成前服务端继续诚实报告 process.exec=false，不能通过配置绕过。
