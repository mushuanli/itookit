# VFS 三包核验

> ⚠️ 已归档：一次性评审记录（所报三个问题均已修复）。当前状态见 `../design/vfs-implementation-status.md`。

日期：2026-09-08。核验当前工作树中 vfs-core、vfsdriver-localfs、vfsdriver-indexeddb 的改动。**最新复核：原先报告的三个问题均已修复，三个包的测试和构建全部通过。** 这不等于真实浏览器或完整应用端到端验收；本轮复核未修改生产代码。

## 首次审查记录（修复前）

| 包 | 现有测试 | 包构建 |
| --- | --- | --- |
| vfs-core | 170 通过 | 通过 |
| vfsdriver-localfs | 54 通过，含 28 项独立进程 Kernel/SQLite 测试 | 通过 |
| vfsdriver-indexeddb | 10 通过，使用 fake-indexeddb | 失败：TS6133，未使用的 `_syncTags` |

## 已确认的问题

1. **IndexedDB 构建阻断（本次改动）**：setTags 改为跨 nodes/tags 的事务后，旧 `_syncTags` 私有方法未删除，导致声明构建失败。删除死代码后重跑包构建。
2. **标签挂载遮蔽不正确（本次改动）**：VFSEngine.listTagEntries 仅比较 backend 对象身份。相同 backend 同时作为根与 `/nested` 挂载时，底层 `/nested/hidden` 的标签错误地出现在虚拟 `/nested/hidden`，实际可见位置应为 `/nested/nested/hidden`。必须根据解析后的挂载位置及后端局部路径判断归属，并补重复挂载回归。
3. **IndexedDB rename 未迁移 records（既有缺口）**：创建 `/old`，在 records 中写入 `/old` 的 state，再 rename 到 `/new`，新路径读取 state 得到 undefined。当前事务仅涉及 nodes/tags，LocalFS 的 rename 则迁移持久记录。需要明确共同契约，并在同一 IndexedDB 事务中迁移文件及子树 records，覆盖目标冲突和失败回滚。

问题 2、3 已分别通过临时回归测试复现；临时测试已从工作树移除，源码副本和失败输出在 `/tmp/audit-vfs-core-repro.test.ts`、`/tmp/audit-vfsdriver-indexeddb-repro.test.ts` 及对应 `-repro.log`。这些临时文件不是长期验收证据；修复时需将场景加入正式测试。

## 验证边界

LocalFS 当前未发现本轮改动的可复现阻断，不能由此推断所有平台适配或任意故障点均正确。IndexedDB 现有测试使用模拟实现，未进行真实浏览器事务/多标签页生命周期验收。三包原有测试通过不覆盖上述新增反例。

复跑命令：分别执行 `pnpm --filter @itookit/<包名> test` 和 `pnpm --filter @itookit/<包名> build`。本轮输出保存在 `/tmp/audit-<包名>.log` 和 `/tmp/audit-<包名>-build.log`。


## 后续修复验证

以下修复已在后续轮次落地，原始审查结论保留作为审计记录：

- IndexedDB 构建：删除未使用的 `_syncTags`，`@itookit/vfsdriver-indexeddb build` 通过。
- 标签挂载遮蔽：`VFSEngine.resolveStore` 不再因 backend 身份相同而绕过实际解析出的挂载；`listTagEntries` 按最终归属挂载路径过滤。新增 `same-backend mount shadowing` 回归测试。
- IndexedDB records 迁移：`rename` 在同一 nodes/tags/records 事务中迁移文件及子树 records，并拒绝目标 nodes/tags/records 冲突；新增文件、子树、目标冲突和事务回滚回归测试。
- 复跑结果：vfs-core 171 通过 / build 通过；vfsdriver-localfs 54 通过 / build 通过；vfsdriver-indexeddb 15 通过 / build 通过。IndexedDB 仍使用 fake-indexeddb，真实浏览器验收边界不变。

## 独立复核结果

再次检查修复代码及正式回归后，重新执行三个包的完整 test/build，六个命令均退出 0：vfs-core 171 项、LocalFS 54 项、IndexedDB 15 项通过，均成功生成 JS 和类型声明。日志为 `/tmp/recheck-<包名>.log` 与 `/tmp/recheck-<包名>-build.log`。

确认点：重复挂载按实际 mountPath 解析及过滤，回归同时验证写入路径；IndexedDB 删除旧 `_syncTags`；rename 将 nodes/tags/records 纳入同一事务，覆盖文件和子树 records 迁移、前缀相似兄弟路径、目标数据冲突，以及注入节点写入失败后的回滚。当前回滚注入发生在 nodes 阶段，尚未单独注入 tags/records 阶段失败；真实浏览器事务生命周期仍未验收。
