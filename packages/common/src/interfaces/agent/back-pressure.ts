// @file: common/interfaces/agent/back-pressure.ts
// 反压验证器接口定义。

import type { BackPressureRule } from './agent-types';

/**
 * 反压验证器接口。
 *
 * 核心思想："LLM 说完成了，真的完成了吗？"
 *
 * 在 LLM 给出最终回复（无工具调用）之前插入验证关卡：
 * 1. 运行配置的验证命令（typecheck / build / test / lint / custom）
 * 2. 通过 → 静默，允许 AgentLoop 退出
 * 3. 失败 → 将错误作为工具结果注入消息历史，让 LLM 继续修正
 *
 * 验证失败不会中断循环，而是让 LLM 自动修复。
 */
export interface IBackPressureValidator {
    /**
     * 工具执行后检查（针对 afterTools 配置的规则）。
     *
     * @param toolName         刚执行完的工具名称
     * @param workingDirectory 当前工作目录
     * @returns 验证结果，null 表示无匹配规则或规则已通过
     */
    checkAfterTool(
        toolName: string,
        workingDirectory: string,
    ): Promise<BackPressureResult | null>;

    /**
     * LLM 最终响应前检查（onlyOnFinal=true 的规则）。
     *
     * @param workingDirectory 当前工作目录
     * @returns 第一个失败的验证结果，null 表示全部通过
     */
    checkBeforeFinal(workingDirectory: string): Promise<BackPressureResult | null>;

    /** 动态添加验证规则 */
    addRule(rule: BackPressureRule): void;

    /** 移除验证规则 */
    removeRule(ruleName: string): void;

    /** 获取所有已配置的规则 */
    getRules(): BackPressureRule[];
}

/**
 * 反压验证结果。
 *
 * passed=true 时 errorMessage 为空，AgentLoop 继续退出流程。
 * passed=false 时 errorMessage 注入消息历史，AgentLoop 继续循环。
 */
export interface BackPressureResult {
    passed: boolean;
    ruleName: string;
    /** 验证失败时的命令输出（stderr + stdout）*/
    errorMessage: string;
}
