// @file: llm-ui/services/AgentLoader.ts

import { IAgentService, SessionManager } from '@itookit/llm-engine';
import { ExecutorOption, ModelOption } from '../domain/types';

export class AgentLoader {
    private cachedAgents: ExecutorOption[] = [];

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
            agentOptions = agentOptions.filter(agent => {
                if (seen.has(agent.id)) return false;
                seen.add(agent.id);
                return true;
            });

            this.cachedAgents = agentOptions;
            return agentOptions;
        } catch (e) {
            console.warn('[AgentLoader] Failed to load agents:', e);
            this.cachedAgents = AgentLoader.FALLBACK_AGENTS;
            return this.cachedAgents;
        }
    }

    /**
     * 验证 agentId — 使用内部缓存，调用者无需传入列表
     */
    validateAgentId(agentId: string): string {
        if (this.cachedAgents.some(a => a.id === agentId)) return agentId;
        console.warn(
            `[AgentLoader] Agent "${agentId}" not found in ${this.cachedAgents.length} cached agents, falling back to default`
        );
        return 'default';
    }

    /**
     * 获取缓存的 agents（只读）
     */
    get agents(): ReadonlyArray<ExecutorOption> {
        return this.cachedAgents;
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
