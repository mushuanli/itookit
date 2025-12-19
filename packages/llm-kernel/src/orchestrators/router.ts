// @file: llm-kernel/orchestrators/router.ts

import { BaseOrchestrator } from './base-orchestrator';
import { IExecutionContext } from '../core/execution-context';
import { ExecutionResult } from '../core/types';
import { RouterRule,IExecutor } from '../core/interfaces';

/**
 * 路由编排器 - 根据条件选择执行路径
 */
export class RouterOrchestrator extends BaseOrchestrator {
    
    async execute(input: unknown, context: IExecutionContext): Promise<ExecutionResult> {
        const routerConfig = this.config.modeConfig?.router;
        
        context.events.emit('node:start', {
            executorId: this.id,
            mode: 'router',
            strategy: routerConfig?.strategy || 'rule'
        });
        
        // 选择目标节点
        const targetChild = await this.selectTarget(input, context);
        
        if (!targetChild) {
            return {
                status: 'failed',
                output: null,
                control: { action: 'end', reason: 'No matching route found' },
                errors: [{
                    code: 'NO_ROUTE',
                    message: 'No matching route found',
                    recoverable: false
                }]
            };
        }
        
        context.events.emit('execution:progress', {
            action: 'route',
            selectedTarget: targetChild.id
        });
        
        return this.executeChild(targetChild, input, context);
    }
    
    private async selectTarget(
        input: unknown,
        context: IExecutionContext
    ): Promise<IExecutor | null> {
        const routerConfig = this.config.modeConfig?.router;
        
        if (routerConfig?.strategy === 'llm') {
            return this.selectByLLM(input, context);
        }
        
        // 默认规则匹配
        return this.selectByRules(input, context, routerConfig?.rules || []);
    }
    
    private selectByRules(
        input: unknown,
        context: IExecutionContext,
        rules: RouterRule[]
    ): IExecutor | null {
        const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
        const vars = context.variables.toObject();
        
        for (const rule of rules) {
            if (this.evaluateCondition(rule.condition, inputStr, vars)) {
                return this.children.find(c => c.id === rule.target) || null;
            }
        }
        
        // 返回第一个作为默认
        return this.children[0] || null;
    }
    
    private evaluateCondition(
        condition: string,
        input: string,
        vars: Record<string, any>
    ): boolean {
        try {
            // 简单的条件评估（生产环境应使用更安全的实现）
            // 支持：contains, startsWith, equals, regex
            
            if (condition.startsWith('contains:')) {
                const keyword = condition.slice(9).trim();
                return input.toLowerCase().includes(keyword.toLowerCase());
            }
            
            if (condition.startsWith('startsWith:')) {
                const prefix = condition.slice(11).trim();
                return input.startsWith(prefix);
            }
            
            if (condition.startsWith('equals:')) {
                const value = condition.slice(7).trim();
                return input === value;
            }
            
            if (condition.startsWith('regex:')) {
                const pattern = condition.slice(6).trim();
                return new RegExp(pattern, 'i').test(input);
            }
            
            if (condition.startsWith('var:')) {
                // 检查变量 e.g., "var:category === 'tech'"
                const expr = condition.slice(4).trim();
                // 简化实现
                return Boolean(vars[expr]);
            }
            
            // 默认：true
            return true;
            
        } catch {
            return false;
        }
    }
    
    private async selectByLLM(
        input: unknown,
        context: IExecutionContext
    ): Promise<IExecutor | null> {
        // 使用 LLM 选择路由（需要配置一个 Agent 子节点作为路由器）
        const routerAgent = this.children.find(c => c.type === 'agent');
        if (!routerAgent) {
            return this.children[0] || null;
        }
        
        const childrenDesc = this.children
            .filter(c => c.id !== routerAgent.id)
            .map(c => `- ${c.id}: ${c.name}`)
            .join('\n');
        
        const routingPrompt = `
Based on the user input, select the most appropriate handler.

Available handlers:
${childrenDesc}

User input: ${typeof input === 'string' ? input : JSON.stringify(input)}

Respond with only the handler ID.
        `.trim();
        
        const routerContext = context.createChild(routerAgent.id);
        const result = await routerAgent.execute(routingPrompt, routerContext);
        
        if (result.status === 'success' && typeof result.output === 'string') {
            const targetId = result.output.trim();
            return this.children.find(c => c.id === targetId) || this.children[0];
        }
        
        return this.children[0] || null;
    }
}
