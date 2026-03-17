// @file: llm-engine/session/agent-resolver.ts

import { ExecutorConfig } from '@itookit/llm-kernel';
import { IAgentService } from '../services/agent-service';
import { EngineError, EngineErrorCode } from '../core/errors';
import { log } from '../utils/logger';

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
 * 
 * ✅ 改进要点：
 * - 不维护自己的缓存（缓存由 VFSAgentService 统一管理）
 * - 每次 resolve 都调用 agentService（agentService 内部走缓存，很快）
 * - resolveModelId 不再做缓存（VFSAgentService.getAgentConfig 已做运行时适配）
 */
export class AgentResolver {
    constructor(private agentService: IAgentService) { }

    /**
     * 解析 agentId 为执行器配置
     * 
     * ✅ 流程：
     * 1. agentService.getAgentConfig() 返回已适配的配置（深拷贝 + 运行时 modelName 解析）
     * 2. agentService.getConnection() 返回缓存的 connection
     * 3. 组装 ExecutorConfig
     */
    async resolve(agentId: string): Promise<ExecutorConfig> {
        try {
            const agentDef = await this.agentService.getAgentConfig(agentId);

            if (agentDef) {
                const connection = await this.agentService.getConnection(
                    agentDef.config.connectionId
                );

                if (!connection) {
                    log.error('Connection not found for agent', {
                        agentId,
                        agentName: agentDef.name,
                        connectionId: agentDef.config.connectionId
                    });
                    throw new EngineError(
                        EngineErrorCode.EXECUTOR_NOT_FOUND,
                        `Connection '${agentDef.config.connectionId}' for agent '${agentDef.name}' not found.`
                    );
                }

                // ✅ modelName 已由 getAgentConfig() 解析为有效的 model ID
                // 这里只需要做一次最终确认
                const modelId = agentDef.config.modelName ||
                    connection.model ||
                    connection.availableModels?.[0]?.id || '';

                return {
                    id: agentDef.id,
                    name: agentDef.name,
                    type: agentDef.type === 'agent' ? 'agent' : 'composite',
                    connection,
                    model: modelId,
                    systemPrompt: agentDef.config.systemPrompt,
                    icon: agentDef.icon,
                } as ExecutorConfig;
            }
        } catch (e) {
            if (e instanceof EngineError) throw e;
            log.error('Failed to resolve agent', { agentId, error: e });
        }

        log.warn('Agent not found, using fallback', { agentId });
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
            log.error('Failed to get available agents', { error: e });
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
     * 获取回退配置
     */
    private async getFallbackConfig(): Promise<ExecutorConfig> {
        const fallbackConnection = await this.agentService.getDefaultConnection();

        if (!fallbackConnection) {
            log.error('CRITICAL: No connections available');
            return {
                id: 'default',
                name: 'Error: No Connection',
                type: 'agent',
                model: '',
            } as ExecutorConfig;
        }

        const modelId =
            fallbackConnection.model || fallbackConnection.availableModels?.[0]?.id || '';

        log.info('Using fallback configuration', {
            connectionId: fallbackConnection.id,
            connectionName: fallbackConnection.name,
            modelId
        });

        return {
            id: 'default',
            name: 'Default Assistant',
            type: 'agent',
            connection: fallbackConnection,
            model: modelId,
        } as ExecutorConfig;
    }
}
