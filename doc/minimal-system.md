# 最小系统运行与验收

本页针对当前代码。已验证 CLI 和原生模块组合链，真实 Tauri GUI/IPC 链仍待验收；总进度见 [todo](todo.md)。不需要 X11 即可执行以下 CLI 命令。

## 不依赖外部模型的组合验收

从仓库根目录执行，环境需已安装依赖、Node.js ≥22.13、Rust、Bash 和 Linux Bubblewrap：

```bash
pnpm --filter @itookit/cli test tests/nested-harness.test.ts
```

测试自动启动本地固定模型响应服务，用标准外层 Kernel tool.call 调用 Bash，调用真实 Tauri Rust 进程模块，在只读 `/app` 与可写 `/workspace` 映射内执行 CLI 子 harness。子 DAG 为 `first → second`；成功场景断言第二节点收到第一节点输出、子结果落盘、外层 Task/Effect 成功且存储重开一致。另有第二节点模型拒绝的失败场景：子 Run failed、没有成功 result.txt，外层工具结果保留 `[exit 1]` 并可重开。Bash 非零退出是工具返回数据，不能仅凭 Effect succeeded 判断子 Run 成功。临时文件由测试清理，不要求真实 API key。非 Linux 平台跳过此测试，不代表验收通过。

测试读取下方同一份公开 YAML 示例，仅替换服务端口。它绕过真实 Tauri IPC，因此不能作为桌面窗口端到端证据。另可运行：

```bash
pnpm --filter @itookit/cli test tests/hitl.test.ts tests/run-scheduler-lock.test.ts
pnpm --filter @itookit/app-shell exec vitest run tests/minimal-skill-dag.test.ts tests/tauri-bash.test.ts
```

分别验证人工暂停的跨进程恢复/调度互斥，以及 Skill→Agent→DAG/平台桥接。沙箱若禁止本地端口或子进程，应在允许这些能力的环境运行。

## 使用自己的模型运行两节点 DAG

公开配置：[minimal-dag.yml](../apps/cli/examples/minimal-dag.yml)。该例明确使用 native 模式且 Agent 不配置 Bash/TTY 工具，适合先验证节点传值；不要把 CLI native 当作 Tauri Session 的 Bubblewrap 隔离。

```bash
pnpm --filter @itookit/cli build
mkdir -p /tmp/x1-minimal-demo
cp apps/cli/examples/minimal-dag.yml /tmp/x1-minimal-demo/workflow.yml
```

编辑复制后的配置：`base_url` 是你的 OpenAI-compatible 服务地址，`default_path` 是聊天接口路径；将 `models[0].id` 与 `connections[0].tiers.standard` 的 `local-model` 同时改为服务实际模型 ID。默认地址 `127.0.0.1:8080` 只是配置示例，本命令不会自动启动模型服务。

在当前终端设置 `MINIMAL_API_KEY` 为服务所需凭证；不需要认证的服务可设置非空测试值。配置文件只保存环境变量名，不写入凭证正文。然后执行：

```bash
node apps/cli/dist/cli.js validate -f /tmp/x1-minimal-demo/workflow.yml --offline
node apps/cli/dist/cli.js graph -f /tmp/x1-minimal-demo/workflow.yml --offline --json
node apps/cli/dist/cli.js run -f /tmp/x1-minimal-demo/workflow.yml --headless --json
node apps/cli/dist/cli.js runs --state-dir /tmp/x1-minimal-demo/.mindos --json
```

`workspace.root: .` 相对于 YAML 所在目录。输出状态位于 `/tmp/x1-minimal-demo/.mindos/runs/<run-id>/`，包括 `run.json`、`result.txt` 和配置快照；成功退出码为 0。模型结果会变化，验收应检查 `first → second` 依赖、Run 成功与结果存在，不要求固定措辞。

若使用含人工交互的其他配置，退出码 3 表示等待输入，从等待事件/manifest 获取 request-id 后执行：

```bash
node apps/cli/dist/cli.js respond <run-id> <request-id> --state-dir /tmp/x1-minimal-demo/.mindos --approve --json
node apps/cli/dist/cli.js resume <run-id> --state-dir /tmp/x1-minimal-demo/.mindos --headless --json
```

以上尖括号参数需替换实际值。resume 复用已有 Run，rerun 创建新 Run。正常人工暂停检查点可恢复，不保证任意崩溃点无重复提交。另一个调度器持锁时 run/resume/delete 的冲突操作会被拒绝。

## Tauri 与 Web 接口

Tauri 已接入 Session Bash 工厂。用户需先明确授权目录：例如仓库只读映射 `/app`，示例工作目录可写映射 `/workspace`；文件存在于映射内且 CLI 已构建时，Bash 工具命令的结构为：

```bash
node /app/apps/cli/dist/cli.js run -f /workspace/workflow.yml --headless --json
```

原生 Session Bash 清空继承环境，因此不能假设终端导出的 API key 会自动进入子 harness。组合验收使用显式注入的无敏感性测试值；真实凭证的桌面子进程注入与配置交付仍需验收，不建议将真实 key 写进会持久记录的 Bash 命令。该命令结构和目录示意尚不是完整桌面操作教程。

Bash 返回 stdout/stderr/退出码，支持超时与取消；原生每个输出流最多保留 1 MiB 原始字节，超出后排空并标注截断。Linux 隔离共享网络，运行库/DNS/证书等可见，不是全封闭网络环境。

Web 保留 `createSessionProcesses` 接口，默认不注入本机 shell；不能在浏览器界面执行上述原生命令。无 X11 可编译 Tauri 和执行 CLI，但真实窗口、IPC、授权与错误反馈仍需单独验收。


当前环境已确认 Xvfb 可用，并以临时配置启动真实 Tauri 窗口，截图验证侧栏与文件列表渲染；这超出了仅编译验证，但尚未完成聊天、目录授权、真实 IPC Bash 子 harness 交互验收。开发启动需本地 Vite 服务，虚拟显示不能自动证明页面功能正确。


另已在真实 Tauri 开发者控制台验证 directory_open→session_shell_exec→directory_close：临时目录内 Bash 的 stdout、stderr 与退出码 7 完整返回。这是实际 IPC 冒烟验证，尚未覆盖外层 harness 通过工具发起调用的完整桌面流程。


真实 Tauri IPC 已进一步验证可启动公开两节点 CLI DAG：只读仓库/可写工作目录映射，单个 Run、两次本地模型请求、依赖传值和结果落盘均通过。该测试由一次性模块直接调用 IPC，外层 harness 的真实工具调度入口仍需贯通；不能把开发者控制台重复求值当作单次运行证据。
