// @file: llm-ui/helpers/AgentLoader.ts

import { IAgentService, SessionManager } from '@itookit/llm-engine';
import { ExecutorOption, ModelOption } from '../views/ChatInputView';

export class AgentLoader {
    constructor(
        private agentService: IAgentService,
        private sessionManager: SessionManager
    ) { }

    /**
     * 加载 Agent 列表
     */
    async loadAgents(): Promise<ExecutorOption[]> {
        try {
            const agents = await this.agentService.getAgents();

            let agentOptions: ExecutorOption[] = agents.map(agent => ({
                id: agent.id,
                name: agent.name,
                icon: agent.icon,
                category: agent.type === 'agent' ? 'Agents' :
                    agent.type === 'workflow' ? 'Workflows' : 'Other',
                description: agent.description,
            }));

            // 确保有默认 Agent
            if (!agentOptions.some(a => a.id === 'default')) {
                agentOptions.unshift({
                    id: 'default',
                    name: 'Default Assistant',
                    icon: '🤖',
                    category: 'System',
                });
            }

            // 去重
            const seen = new Set<string>();
            return agentOptions.filter(agent => {
                if (seen.has(agent.id)) return false;
                seen.add(agent.id);
                return true;
            });
        } catch (e) {
            console.warn('[AgentLoader] Failed to load agents:', e);
            return AgentLoader.FALLBACK_AGENTS;
        }
    }

    /**
     * ✅ 新增：校验 agentId 是否仍然有效
     * 如果无效，返回 'default'
     */
    validateAgentId(agentId: string, agents: ExecutorOption[]): string {
        if (agents.some(a => a.id === agentId)) return agentId;

        console.warn(
            `[AgentLoader] Agent "${agentId}" no longer exists, falling back to default`
        );
        return 'default';
    }

    /**
     * 加载指定 Agent 的可用模型
     */
    async loadModelsForAgent(agentId: string): Promise<ModelOption[]> {
        try {
            const models = await this.sessionManager.getModelsForAgent(agentId);
            return models.map(m => ({
                id: m.id,
                name: m.name,
                provider: m.provider,
            }));
        } catch (e) {
            console.error('[AgentLoader] loadModelsForAgent failed:', e);
            return [];
        }
    }

    private static readonly FALLBACK_AGENTS: ExecutorOption[] = [{
        id: 'default',
        name: 'Default Assistant',
        icon: '🤖',
        category: 'System',
    }];
}
