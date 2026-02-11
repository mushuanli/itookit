// @file: llm-engine/session/services/executor-resolver-service.ts

import { ExecutorConfig } from '@itookit/llm-kernel';
import { IAgentService } from '../../services/agent-service';
import { EngineError, EngineErrorCode } from '../../core/errors';

/**
 * 执行器解析服务
 * 负责 Agent 配置解析、模型 ID 映射和缓存
 */
export class ExecutorResolverService {
    // 模型 ID 解析缓存: `${connectionId}:${modelName}` -> realModelId
    private modelResolutionCache = new Map<string, string>();

    constructor(private agentService: IAgentService) {
        // 监听 AgentService 变更，清空缓存
        this.agentService.onChange(() => {
            this.modelResolutionCache.clear();
        });
    }

    /**
     * 解析执行器配置
     */
    async resolve(executorId: string): Promise<ExecutorConfig> {
        try {
            const agentDef = await this.agentService.getAgentConfig(executorId);

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

                const realModelId = this.resolveModelIdWithCache(
                    connection,
                    agentDef.config.modelName
                );

                return {
                    id: agentDef.id,
                    name: agentDef.name,
                    type: agentDef.type === 'agent' ? 'agent' : 'composite',
                    connection,
                    model: realModelId,
                    systemPrompt: agentDef.config.systemPrompt
                } as ExecutorConfig;
            }
        } catch (e) {
            console.warn(`[ExecutorResolver] Failed to resolve ${executorId}:`, e);
        }

        return this.getFallbackConfig();
    }

    /**
     * 带缓存的模型 ID 解析
     */
    private resolveModelIdWithCache(connection: any, modelName: string): string {
        if (!modelName) return '';

        const cacheKey = `${connection.id}:${modelName}`;

        // 查缓存
        if (this.modelResolutionCache.has(cacheKey)) {
            return this.modelResolutionCache.get(cacheKey)!;
        }

        // 解析逻辑
        let realId = modelName;

        if (connection.availableModels && Array.isArray(connection.availableModels)) {
            // 优先匹配 Name
            const matchedByName = connection.availableModels.find(
                (m: any) => m.name === modelName
            );

            if (matchedByName) {
                realId = matchedByName.id;
            } else {
                // 检查是否本身就是 ID
                const matchedById = connection.availableModels.find(
                    (m: any) => m.id === modelName
                );
                if (matchedById) {
                    realId = matchedById.id;
                }
            }
        }

        // 写缓存
        this.modelResolutionCache.set(cacheKey, realId);
        return realId;
    }

    /**
     * 获取回退配置
     */
    private async getFallbackConfig(): Promise<ExecutorConfig> {
        const fallbackConnection = await this.agentService.getDefaultConnection();

        if (!fallbackConnection) {
            console.error('[ExecutorResolver] CRITICAL: No connections available.');
            return {
                id: 'default',
                name: 'Error: No Connection',
                type: 'agent',
                model: ''
            } as ExecutorConfig;
        }

        const modelId = fallbackConnection.model ||
            (fallbackConnection.availableModels?.[0]?.id || '');

        return {
            id: 'default',
            name: 'Default Assistant',
            type: 'agent',
            connection: fallbackConnection,
            model: modelId
        } as ExecutorConfig;
    }

    /**
     * 获取可用执行器列表
     */
    async getAvailableExecutors(): Promise<Array<{
        id: string;
        name: string;
        icon?: string;
        category?: string;
        description?: string;
    }>> {
        try {
            const agents = await this.agentService.getAgents();

            const executors = agents.map(agent => ({
                id: agent.id,
                name: agent.name,
                icon: agent.icon,
                category: agent.type === 'agent' ? 'Agents' : 'Workflows',
                description: agent.description
            }));

            executors.unshift({
                id: 'default',
                name: 'Default Assistant',
                icon: '🤖',
                category: 'System',
                description: 'Built-in default assistant'
            });

            return executors;

        } catch (e) {
            console.error('[ExecutorResolver] getAvailableExecutors failed:', e);
            return [{
                id: 'default',
                name: 'Default Assistant',
                icon: '🤖',
                category: 'System'
            }];
        }
    }

    /**
     * 获取 Agent 对应的可用模型
     */
    async getAvailableModelsForAgent(agentId: string): Promise<Array<{
        id: string;
        name: string;
        provider?: string;
    }>> {
        try {
            const agentConfig = await this.agentService.getAgentConfig(agentId);

            if (!agentConfig?.config.connectionId) {
                const defaultConn = await this.agentService.getDefaultConnection();
                if (!defaultConn?.availableModels) return [];

                return defaultConn.availableModels.map(m => ({
                    id: m.id,
                    name: m.name,
                    provider: defaultConn.name,
                }));
            }

            const connection = await this.agentService.getConnection(
                agentConfig.config.connectionId
            );

            if (!connection?.availableModels) {
                return [];
            }

            return connection.availableModels.map(m => ({
                id: m.id,
                name: m.name,
                provider: connection.name,
            }));

        } catch (e) {
            console.error('[ExecutorResolver] getAvailableModelsForAgent failed:', e);
            return [];
        }
    }

    /**
     * 清空缓存
     */
    clearCache(): void {
        this.modelResolutionCache.clear();
    }
}
