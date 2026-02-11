// @file: llm-engine/session/agent-resolver.ts

import { ExecutorConfig } from '@itookit/llm-kernel';
import { IAgentService } from '../services/agent-service';
import { EngineError, EngineErrorCode } from '../core/errors';

/**
 * Agent 信息（列表展示用）
 */
export interface AgentInfo {
    id: string;
    name: string;
    icon?: string;
    category?: string;
    description?: string;
}

/**
 * 模型信息
 */
export interface ModelInfo {
    id: string;
    name: string;
    provider?: string;
}

/**
 * Agent 解析器
 * 将 agentId 解析为 Kernel 可用的 ExecutorConfig
 */
export class AgentResolver {
    constructor(private agentService: IAgentService) { }

    /**
     * 解析 agentId 为执行器配置
     */
    async resolve(agentId: string): Promise<ExecutorConfig> {
        try {
            const agentDef = await this.agentService.getAgentConfig(agentId);

            if (agentDef) {
                const connection = await this.agentService.getConnection(
                    agentDef.config.connectionId
                );

                if (!connection) {
                    throw new EngineError(
                        EngineErrorCode.EXECUTOR_NOT_FOUND,
                        `Connection '${agentDef.config.connectionId}' for agent '${agentDef.name}' not found.`
                    );
                }

                const realModelId = this.resolveModelId(connection, agentDef.config.modelName);

                return {
                    id: agentDef.id,
                    name: agentDef.name,
                    type: agentDef.type === 'agent' ? 'agent' : 'composite',
                    connection,
                    model: realModelId,
                    systemPrompt: agentDef.config.systemPrompt,
                } as ExecutorConfig;
            }
        } catch (e) {
            if (e instanceof EngineError) throw e;
            console.warn(`[AgentResolver] Failed to resolve ${agentId}:`, e);
        }

        return this.getFallbackConfig();
    }

    /**
     * 获取可用 Agent 列表
     */
    async getAvailableAgents(): Promise<AgentInfo[]> {
        try {
            const agents = await this.agentService.getAgents();

            const list: AgentInfo[] = [
                {
                    id: 'default',
                    name: 'Default Assistant',
                    icon: '🤖',
                    category: 'System',
                    description: 'Built-in default assistant',
                },
            ];

            for (const agent of agents) {
                list.push({
                    id: agent.id,
                    name: agent.name,
                    icon: agent.icon,
                    category: agent.type === 'agent' ? 'Agents' : 'Workflows',
                    description: agent.description,
                });
            }

            return list;
        } catch (e) {
            console.error('[AgentResolver] getAvailableAgents failed:', e);
            return [{ id: 'default', name: 'Default Assistant', icon: '🤖', category: 'System' }];
        }
    }

    /**
     * 获取指定 Agent 可用的模型列表
     */
    async getModelsForAgent(agentId: string): Promise<ModelInfo[]> {
        try {
            const agentConfig = await this.agentService.getAgentConfig(agentId);
            const connectionId = agentConfig?.config.connectionId;

            const connection = connectionId
                ? await this.agentService.getConnection(connectionId)
                : await this.agentService.getDefaultConnection();

            if (!connection?.availableModels) return [];

            return connection.availableModels.map((m) => ({
                id: m.id,
                name: m.name,
                provider: connection.name,
            }));
        } catch (e) {
            console.error('[AgentResolver] getModelsForAgent failed:', e);
            return [];
        }
    }

    /**
     * 解析模型 ID：modelName -> 真实 model ID
     */
    private resolveModelId(connection: any, modelName: string): string {
        if (!modelName) return '';
        if (!connection.availableModels || !Array.isArray(connection.availableModels)) {
            return modelName;
        }

        // 优先匹配 name
        const byName = connection.availableModels.find((m: any) => m.name === modelName);
        if (byName) return byName.id;

        // 再匹配 id
        const byId = connection.availableModels.find((m: any) => m.id === modelName);
        if (byId) return byId.id;

        return modelName;
    }

    /**
     * 获取回退配置
     */
    private async getFallbackConfig(): Promise<ExecutorConfig> {
        const fallbackConnection = await this.agentService.getDefaultConnection();

        if (!fallbackConnection) {
            console.error('[AgentResolver] CRITICAL: No connections available.');
            return {
                id: 'default',
                name: 'Error: No Connection',
                type: 'agent',
                model: '',
            } as ExecutorConfig;
        }

        const modelId =
            fallbackConnection.model || fallbackConnection.availableModels?.[0]?.id || '';

        return {
            id: 'default',
            name: 'Default Assistant',
            type: 'agent',
            connection: fallbackConnection,
            model: modelId,
        } as ExecutorConfig;
    }
}
