// @file: llm-ui/services/AgentLoader.ts

import { IAgentConfigService } from '@itookit/llm-engine';
import { ExecutorOption, ConnectionOption } from '../domain/types';

export class AgentLoader {
    private cachedAgents: ExecutorOption[] = [];

    constructor(private agentService: IAgentConfigService) { }

    /**
     * 加载 Agent 列表
     */
    async loadAgents(): Promise<ExecutorOption[]> {
        try {
            const [agents, connections] = await Promise.all([
                this.agentService.getAgents(),
                this.agentService.getConnections().catch(() => []),
            ]);
            const connMap = new Map(connections.map(c => [c.id, c]));

            let agentOptions: ExecutorOption[] = agents.map(agent => {
                const conn = agent.config?.connectionId
                    ? connMap.get(agent.config.connectionId)
                    : undefined;
                return {
                    id: agent.id,
                    name: agent.name,
                    icon: agent.icon,
                    category: agent.type === 'agent' ? 'Agents' :
                        agent.type === 'workflow' ? 'Workflows' : 'Other',
                    description: agent.description,
                    provider: conn?.provider,
                    connectionName: conn?.name,
                    connectionId: agent.config?.connectionId,
                };
            });

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
     * 加载所有可用连接（供 ChatInput 连接选择器使用）
     */
    async loadConnections(): Promise<ConnectionOption[]> {
        try {
            const connections = await this.agentService.getConnections();
            return connections
                .filter(c => c.enabled !== false)   // hide disabled connections from selector
                .map(c => ({
                    id: c.id,
                    name: c.name,
                    provider: c.provider,
                    hasTiers: !!(c.tiers?.standard || c.tiers?.fast),
                }));
        } catch (e) {
            console.error('[AgentLoader] loadConnections failed:', e);
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
