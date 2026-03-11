// @file: llm-ui/helpers/AgentLoader.ts

import { IAgentService, SessionManager } from '@itookit/llm-engine';
import { ExecutorOption, ModelOption } from '../views/ChatInputView';

export class AgentLoader {
    constructor(
        private agentService: IAgentService,
        private sessionManager: SessionManager
    ) { }

    /**
     * 加载初始 Agent 列表
     */
    async loadInitialAgents(): Promise<ExecutorOption[]> {
        try {
            const agents = await this.agentService.getAgents();

            let initialAgents: ExecutorOption[] = agents.map(agent => ({
                id: agent.id,
                name: agent.name,
                icon: agent.icon,
                category: agent.type === 'agent' ? 'Agents' :
                    agent.type === 'workflow' ? 'Workflows' : 'Other',
                description: agent.description
            }));

            // 确保有默认 Agent
            const hasDefault = initialAgents.some(a => a.id === 'default');
            if (!hasDefault) {
                initialAgents.unshift({
                    id: 'default',
                    name: 'Default Assistant',
                    icon: '🤖',
                    category: 'System'
                });
            }

            // 去重
            const seen = new Set<string>();
            return initialAgents.filter(agent => {
                if (seen.has(agent.id)) return false;
                seen.add(agent.id);
                return true;
            });

        } catch (e) {
            console.warn('[AgentLoader] Failed to get initial agents:', e);
            return [{
                id: 'default',
                name: 'Default Assistant',
                icon: '🤖',
                category: 'System'
            }];
        }
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
}
