// @file: llm-engine/session/agent-resolver.ts

import { ExecutorConfig } from '@itookit/llm-kernel';
import { resolveModelForTier } from '@itookit/common';
import { IAgentConfigService } from '../services/agent-service';
import { EngineError, EngineErrorCode } from '../core/errors';
import { log } from '../utils/logger';

export interface AgentInfo {
    id: string;
    name: string;
    icon?: string;
    category?: string;
    description?: string;
}

export interface ModelInfo {
    id: string;
    name: string;
    provider?: string;
}

/**
 * Agent 解析器
 *
 * 将 agentId 解析为 ExecutorConfig。
 * ConnectionMeta（不含 apiKey）供 UI 和模型列表使用；
 * 完整连接（含 apiKey）由 LLMDeviceDriver 内部通过 connectionId 解析。
 */
export class AgentResolver {
    constructor(private agentService: IAgentConfigService) {}

    async resolve(agentId: string): Promise<ExecutorConfig> {
        let config: ExecutorConfig | null = null;

        try {
            const agentDef = await this.agentService.getAgentConfig(agentId);

            if (agentDef) {
                const connMeta = await this.agentService.getConnection(agentDef.config.connectionId);

                if (!connMeta) {
                    log.error('Connection not found for agent', {
                        agentId, agentName: agentDef.name, connectionId: agentDef.config.connectionId,
                    });
                    throw new EngineError(
                        EngineErrorCode.EXECUTOR_NOT_FOUND,
                        `Connection '${agentDef.config.connectionId}' for agent '${agentDef.name}' not found.`
                    );
                }

                // Priority: explicit modelName pin > tier lookup > resolved optimal (conn.model)
                const modelId = agentDef.config.modelName
                    || resolveModelForTier(connMeta, agentDef.config.modelTier ?? 'optimal')
                    || '';

                config = {
                    id: agentDef.id,
                    name: agentDef.name,
                    type: 'agent', // AgentDefinition.type is a UI category; chat always runs via agent executor
                    connectionId: agentDef.config.connectionId,
                    model: modelId,
                    systemPrompt: agentDef.config.systemPrompt,
                    icon: agentDef.icon,
                } as ExecutorConfig;
            }
        } catch (e) {
            if (e instanceof EngineError) throw e;
            log.error('Failed to resolve agent', { agentId, error: e });
        }

        if (!config) {
            log.warn('Agent not found, using fallback', { agentId });
            config = await this.getFallbackConfig();
        }

        return config;
    }

    async getAvailableAgents(): Promise<AgentInfo[]> {
        try {
            const agents = await this.agentService.getAgents();
            const list: AgentInfo[] = [{
                id: 'default', name: 'Default Assistant', icon: '🤖',
                category: 'System', description: 'Built-in default assistant',
            }];
            for (const agent of agents) {
                list.push({
                    id: agent.id, name: agent.name, icon: agent.icon,
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

    async getModelsForAgent(agentId: string): Promise<ModelInfo[]> {
        try {
            const agentConfig = await this.agentService.getAgentConfig(agentId);
            const connectionId = agentConfig?.config.connectionId;

            const connMeta = connectionId
                ? await this.agentService.getConnection(connectionId)
                : await this.agentService.getDefaultConnection();

            // Model catalog is now on the Provider, not ConnectionMeta.
            // Return the resolved optimal model as the only option.
            if (!connMeta?.model) return [];
            return [{ id: connMeta.model, name: connMeta.model, provider: connMeta.name }];
        } catch (e) {
            console.error('[AgentResolver] getModelsForAgent failed:', e);
            return [];
        }
    }

    private async getFallbackConfig(): Promise<ExecutorConfig> {
        const connMeta = await this.agentService.getDefaultConnection();

        if (!connMeta) {
            log.error('CRITICAL: No connections available');
            return { id: 'default', name: 'Error: No Connection', type: 'agent', model: '' } as ExecutorConfig;
        }

        const modelId = resolveModelForTier(connMeta, 'optimal') || '';

        log.info('Using fallback configuration', {
            connectionId: connMeta.id, connectionName: connMeta.name, modelId,
        });

        return {
            id: 'default', name: 'Default Assistant', type: 'agent',
            connectionId: connMeta.id,
            model: modelId,
        } as ExecutorConfig;
    }
}
