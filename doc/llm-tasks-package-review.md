# LLM Tasks 改动核验

日期：2026-09-09。检查当前 llm-tasks 改动及上下文/动态 Skill 工具调用链。本轮未修改生产代码。

最新复核：此前报告的同批次审批遗漏、重复 call ID 和旧审批状态兼容问题均已修复；32 项正式测试、类型检查及构建通过。本轮未发现新的可复现阻断。以下保留历次审查记录，最新验证范围见文末。

## 验证结果

- `pnpm --filter @itookit/llm-tasks test:run`：6 个文件、28 项通过。
- `pnpm --filter @itookit/llm-tasks typecheck`：通过。
- `pnpm --filter @itookit/llm-tasks build`：通过，含类型声明。
- 新增临时反例：1 项失败，加载 Skill 后实际 phase 为 tool，期望 approval。临时测试已移出仓库，副本为 `/tmp/tasks-review-repro.test.ts`，输出为 `/tmp/tasks-review-repro.log`。

## 阻断问题：同批次动态 Skill 工具绕过外部操作审批

位置：`src/durable/agent-program.ts` 的 prepareCalls、handleTool、requestTool。

条件：`approval: external`；allowedToolIds 包含 load_skill 和 publish，但初始 externalToolIds 不包含尚未发现的 publish。模型在同一 assistant tool_calls 中先调用 load_skill，再调用 publish。

过程：批次开始时 requiresApproval 还不知道 publish 的外部副作用；load_skill 成功后，skillContext.tools 将 publish 标记为 external。handleTool 保存新上下文，推进 callIndex 后直接 requestTool，没有重新检查审批，因此输出 publish 的 tool.call Effect 而非 interaction wait。

已有测试只验证下一次 LLM 响应中的 publish 会触发审批，未覆盖同批次后续调用。本反例验证 reducer 的决策错误；不声称已调用真实外部服务，也不声称它绕过了底层 resource grant。

修复要求：每次实际发出工具 Effect 前根据最新可信工具元数据检查审批；持久记录已批准调用及其边界，避免重复审批或把旧批次批准扩展为新增能力批准。拒绝后的工具结果只能补给尚未执行的 calls，不能重放前面已完成的 load_skill。补同批次加载/外部调用、批准、拒绝、状态序列化恢复测试。

## 已核对功能及边界

- 每轮上下文压缩保留系统指令、最后用户消息和完整工具结果组；LLM Effect 使用 exchange 序号，避免压缩后消息数重复导致身份冲突。
- Skill compactInstructions 存入持久 state，历史工具消息裁剪后仍注入；动态工具定义仅纳入 allowedToolIds 集合。
- ContextAssembler 加入项目/Skill 指令，预算裁剪优先删除 skill-index。
- maxMessages 是裁剪触发阈值而非硬上限：系统消息、用户消息和完整工具组可能使结果超限；也不是 token/字节预算。
- 当前 Skill 恢复测试主要通过 JSON 序列化 state 模拟，不能独自证明真实 Kernel 跨进程恢复和全部 provider 集成。

测试/构建日志：`/tmp/tasks-review-test-run.log`、`/tmp/tasks-review-typecheck.log`、`/tmp/tasks-review-build.log`。

## 修复后复核（2026-09-09）

dispatchNextCall 在每个工具 Effect 前重查当前 call 的 external 元数据；handleTool 经该入口继续执行；handleInteraction 校验 interactionId，批准仅登记当前调用；appendRejected 使用 pendingCalls.slice(callIndex)，保留已执行结果。新增正式测试验证同批次动态加载、批准、拒绝及 JSON 状态恢复。重新运行 test:run 为 29 通过，typecheck/build 均通过。

仍需修复：approvedCallIds 仅按 ID 判断，handleLlm 没有校验同批 tool_calls 的 ID 唯一性。临时反例在 approval: all 下提交同 ID 的 read/publish 两个不同调用，批准 read 并完成后，publish 直接产生 tool.call Effect，没有新审批。Kernel addEffect 会因同 Effect ID 的请求不同而拒绝提交，故此反例不证明真实 publish 已执行；它证明 Agent 批次校验缺失及批准被错误复用。

建议首先在接受模型 tool_calls 时拒绝空/重复 ID，在任何工具执行前报错；需要更一般的审批范围保证时，将轮次、call ID、工具身份和参数指纹纳入持久记录。补重复 ID、不同参数、后续轮次批准不继承，以及实际 Kernel 恢复的回归。

临时测试已移出仓库：`/tmp/tasks-recheck-approval-repro.test.ts`，失败日志 `/tmp/tasks-recheck-approval-repro.log`。正式复核日志 `/tmp/tasks-recheck-test-run.log`、`/tmp/tasks-recheck-typecheck.log`、`/tmp/tasks-recheck-build.log`。

## 再次复核：审批范围修复与旧状态兼容

重复/空 ID 在发出工具前拒绝；approvedCallKeys 绑定 roundId、exchange、call ID、工具名与规范化参数；审批 interaction 与工具 Effect 身份均加入 exchange。本次 test:run 31 通过、typecheck/build 通过。

新发现：DurableAgentProgram.manifest.version 仍为 1，但旧状态 phase=approval 所对应的持久 interaction ID 是原 call.id，新 handleInteraction 只接受 `approval:<exchange>:<call.id>`。例如旧任务等待 publish-call，重启升级后用户批准 publish-call，reduce 返回 fail（Unexpected approval interaction），合法回应不能继续原任务。当前没有旧审批格式的迁移或版本兼容分支。

已用旧版状态形状（无 approvedCallKeys、有 approvedCallIds、phase=approval）和原 interaction-resolved 输入复现；这是 reducer 级兼容反例，未冒充完整旧进程升级集成测试。临时测试已移至 `/tmp/tasks-final-review-legacy.test.ts`，输出 `/tmp/tasks-final-review-legacy.log`。

修复方向：持久标记审批协议版本与待回应 interaction ID，为旧记录提供严格兼容路径；或发布新 Program 版本并保留旧版本执行器/显式迁移。不能仅 bump version 后移除旧执行器，也不能无条件接受任意旧 call ID。迁移后仍需保持新指纹约束，覆盖旧审批待回应、已回应未消费与多调用批次恢复。

本次正式验证日志：`/tmp/tasks-final-review-test-run.log`、`/tmp/tasks-final-review-typecheck.log`、`/tmp/tasks-final-review-build.log`。

## 旧审批兼容修复复核

新增 approvalProtocol 和 pendingApprovalInteractionId。旧形状（无 approvedCallKeys 且非协议 2）仅接受当前 pending call 的原 ID；批准后生成当前调用的审批指纹并迁移到协议 2，拒绝后仅补充剩余调用结果。新状态保存实际待回应 ID；上一轮中有 approvedCallKeys 但尚无协议字段的状态仍按带 exchange 的 ID 处理。后续批次重置批准记录及待回应 ID。

正式新增回归覆盖旧审批状态的批准、拒绝和已执行 load_skill 结果保留。重新执行 test:run：32 项通过；typecheck、build：均退出 0，类型声明生成成功。此前报告的具体缺陷在当前代码中已闭合。

日志：`/tmp/tasks-compat-review-test-run.log`、`/tmp/tasks-compat-review-typecheck.log`、`/tmp/tasks-compat-review-build.log`。兼容回归以 JSON 状态恢复后调用 reducer 为证据，尚未覆盖真实旧版本进程退出、升级后二进制重开全部持久记录的端到端流程；不将本次通过扩大为所有 provider/平台或完整 llm-tasks 设计验收。

## 修复后复核（2026-09-09，第二轮）

- `handleLlm` 在接受模型 `tool_calls` 后、任何工具 Effect 之前拒绝空 ID、同批重复 ID 和空工具名，失败码为 `INVALID_TOOL_CALLS`。
- `approvedCallIds` 升级为 `approvedCallKeys`，记录 `roundId`、exchange、call ID、工具名和参数指纹，避免同 ID 不同工具/参数复用批准。
- approval interaction ID 与 tool Effect ID 均包含 exchange，后续轮次复用 provider call ID 时不会继承审批或发生 Effect 身份冲突。
- 新增回归：空/重复 ID 在首个工具执行前失败、后续轮次同 ID 不继承审批。
- 验证：`llm-tasks` test:run 31 通过，typecheck/build 通过；`llm-flow` 126 通过。

## 修复后复核（2026-09-09，第三轮）

- Program 版本保持 `1`，避免旧任务因版本不匹配被阻塞。
- 新状态持久标记 `approvalProtocol: 2` 和 `pendingApprovalInteractionId`。
- 旧状态（无 `approvalProtocol` / `approvedCallKeys`，存在旧 `approvedCallIds` 或原 `call.id` 审批 ID）走严格兼容分支：只接受当前 pending call 的原 `call.id`，批准/拒绝后立即迁移到新协议。
- 兼容迁移后仍使用 `approvedCallKeys` 指纹约束，不会无条件接受任意旧 ID。
- 新增旧状态批准、拒绝和多调用批次恢复测试。
- 验证：`llm-tasks` test:run 32 通过，typecheck/build 通过；`llm-flow` 126 通过。
