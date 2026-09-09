# 已归档文档（deprecated）

本目录存放**不再随代码更新**的文档：一次性评审记录、已被取代的设计方案、时点状态快照。
它们只保留决策与审查过程的证据，**不能作为当前实现的依据**；当前规范请看下表"替代文档"。

| 归档文档 | 性质 | 替代 / 现状 |
|---|---|---|
| `vfs-session-fs.md` | 已被取代的 SessionFS 设计方案（文中 53 处接口均未实现） | [Session 文件与目录](../design/vfs-session-browser.md)、`packages/app-core/src/files/session-files.ts` |
| `vfs-namespace-refactor.md` | 已作废的命名空间迁移提案（以 `IModuleFS`/`moduleId` 为核心） | [VFS 设计](../design/VFS-design.md)、[C4 与接口](../design/vfs-c4-review.md) |
| `vfs-consumer-migration.md` | 已作废的消费方迁移提案（`Legacy*Adapter` 未落地） | [VFS 实现状态](../design/vfs-implementation-status.md) |
| `implementation-audit.md` | 2026-09-08 时点扫描台账（含 `/tmp` 日志） | [TODO 与进度](../todo.md) |
| `stat.md` | 2026-09-07 durable-kernel 工作状态快照 | [Kernel API](../kernel-api.md)、[TODO 与进度](../todo.md) |
| `llm-tasks-package-review.md` | 一次性评审记录（结论仍成立） | [llm-tasks API](../llm-tasks-api.md) |
| `vfs-package-review.md` | 一次性评审记录（三个问题均已修复） | [VFS 实现状态](../design/vfs-implementation-status.md) |
| `durable-kernel-package-review.md` | 一次性评审记录（结论仍成立） | [Kernel API](../kernel-api.md) |
| `kernel-adapters-package-review.md` | 一次性评审记录（**两个 Effect 回滚问题仍未修复**，见 [TODO](../todo.md)） | `packages/kernel-adapters/src/effects/` |
| `llm-settings-ui-package-review.md` | 一次性评审记录（修复已落地） | `packages/llm-settings-ui/` |
| `packages-doc/*` | `packages/doc/` 目录下的陈旧副本（引用已删除的 `llm-runtime`/`llm-conversation`） | `doc/` 根目录同名文档 |
| `vfs-core-README.md` | `packages/vfs-core/README.md` 的 v4.1 前接口规范（`IModuleFS`、ino 三层存储、`common/interfaces/fs/` 路径） | [VFS 设计](../design/VFS-design.md)、`packages/vfs-core/doc/key-classes.md` |
| `device-llm-README.md` | `packages/device-llm/README.md` 的一次性重构方案（迁移到不存在的 `llm-kernel`/`llm-runtime`，包名 `@itookit/llm-driver`） | `packages/device-llm/AGENTS.md` |
| `common-interface-catalog.md` | `packages/common/interface-catalog.md` 的失效接口清单（`interfaces/fs/`、`IModuleFS`、`ISessionEngine`） | `packages/common/AGENTS.md`、[接口契约](../interface-contracts.md) |

历史设计归档见 [`../feat/`](../feat/)（同一约定：不随代码更新）。
