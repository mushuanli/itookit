# Kernel Adapters 改动核验

> ⚠️ 已归档：一次性评审记录；其中两个 Effect 回滚问题**仍未修复**，追踪见 `../todo.md`。

日期：2026-09-09。范围为当前 kernel-adapters 工作树改动，重点检查 Session scope、Skill 加载持久身份、工具 Effect 与失败清理。本轮未修改生产代码。

结论：现有 81 项测试、类型检查及构建通过，但额外故障注入复现两类问题（3 项反例失败），不能标记正确完整。

## 问题 1：加载持久化失败后仍保留活跃 Skill

`effects/skill-load-effect.ts` 先 service.loadSkill，再执行 onLoaded 持久化；`tool.call(load_skill)` 经 runtime 回调执行相同的持久登记。两者均缺少登记失败时的内存状态恢复。

复现使用实际 createKernelAdaptersRuntime，注册一个 autoLoad=false 的 review Skill，给 sessionState.set 注入明确的写入前失败。两种 Effect 均 reject，但 sessions.get(...).skillService.getLoadedSkills() 仍包含 review，持久集合则未写入。失败的加载因而影响同一运行时后续上下文，重开后的状态却不同。本反例不声称授予了原先没有的 Kernel resource 权限。

修复建议：共用加载/持久登记的失败处理，记录调用前是否已加载，恢复此前状态或使作用域失效并从持久事实重建；不要把原本成功加载的 Skill 一律卸载。若存储错误可能发生在实际提交之后，应先核验持久结果或保持不可用状态，不能假设失败等于未写入。工具加载、skill.load 与宿主 controls 的一致性都需回归。

## 问题 2：初始化异常的清理被 release 错误中断

`runtime/create-kernel-adapters-runtime.ts` 的 createScope catch 顺序执行 files.release、toolDriver.dispose、skillDriver.dispose。若 release reject，后两步不执行，原始初始化错误也被覆盖。

复现：Skill source 扫描抛出 scan failed，同时文件 release 抛出 release failed，观察 ToolDeviceDriver.dispose 未被调用。当前创建失败的 scope 会从 registry 移除，不能依赖最终 runtime.dispose 自动找到它。

修复建议：按资源依赖顺序逐项尝试清理，即使某一步失败也继续其他步骤；合并原始初始化错误和清理错误。同步检查 source 工厂失败、tool init/setCwd 失败以及 configureSession 失败分支，不要仅修一个 catch。

## 验证结果及边界

- `pnpm --filter @itookit/kernel-adapters test`：13 个文件、81 项通过。
- `pnpm --filter @itookit/kernel-adapters typecheck`：通过。
- `pnpm --filter @itookit/kernel-adapters build`：通过，含类型声明。
- 临时故障测试：skill.load 与 tool.call 持久失败各 1 项，初始化双重失败 1 项，均复现。
- 临时测试已移出仓库，副本 `/tmp/adapters-review-repro.test.ts`；输出 `/tmp/adapters-review-repro.log`。正式验证日志 `/tmp/adapters-review-test.log`、`/tmp/adapters-review-typecheck.log`、`/tmp/adapters-review-build.log`。

本轮确认了作用域隔离、Skill 禁用标记、持久身份严格解析、操作队列、索引大小控制、支持文件边界和指令快照等已有测试；未将这些单包测试等同于真实 Tauri/Bash、浏览器或完整 Skill 生命周期验收。Skill 严格版本冻结及其他设计扩展仍以 skill-design 的有效目标逐项验收。
