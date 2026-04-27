// @file: llm-engine/session/agent-resolver.ts

import { ExecutorConfig } from '@itookit/llm-kernel';
import { resolveModelForTier, ModelTier } from '@itookit/common';
import type { ConnectionMeta } from '@itookit/common';
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

                const currentTier = agentDef.config.modelTier ?? 'optimal';
                const { enableThinking, reasoningEffort } =
                    this.resolveThinkingConfig(connMeta, currentTier, modelId);

                config = {
                    id: agentDef.id,
                    name: agentDef.name,
                    type: 'agent', // AgentDefinition.type is a UI category; chat always runs via agent executor
                    connectionId: agentDef.config.connectionId,
                    model: modelId,
                    enableThinking,
                    reasoningEffort,
                    systemPrompt: agentDef.config.systemPrompt,
                    icon: agentDef.icon,
                    temperature: agentDef.config.temperature,
                };

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

    /**
     * 记录一次 LLM 用量到对应连接的 dailyCosts。
     */
    async recordUsageCost(connectionId: string, usage: {
        inputTokens: number; outputTokens: number; cost: number;
    }): Promise<void> {
        if (!connectionId) return;
        try {
            const conn = await this.agentService.getFullConnection(connectionId);
            if (!conn) return;
            const today = new Date().toISOString().slice(0, 10);
            const dailyCosts = { ...(conn.dailyCosts ?? {}) };
            const entry = dailyCosts[today];
            if (entry) {
                entry.inputTokens  += usage.inputTokens;
                entry.outputTokens += usage.outputTokens;
                entry.cost         += usage.cost;
                entry.requests     += 1;
            } else {
                dailyCosts[today] = {
                    date: today,
                    inputTokens:  usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    cost:         usage.cost,
                    requests:     1,
                };
            }
            conn.dailyCosts = dailyCosts;
            await this.agentService.saveConnection(conn);
        } catch (e) {
            log.error('Failed to record usage cost', { connectionId, error: e });
        }
    }

    /**
     * 根据 overrides 重解析模型 ID。
     *
     * 当用户切换连接或模型层级时，需要重新查新连接的 tiers 映射来解析模型。
     */
    async reResolveModel(config: ExecutorConfig, overrides: {
        connectionId?: string;
        modelTier?: ModelTier;
    }): Promise<ExecutorConfig> {
        const newConfig = { ...config };
        const connId = overrides.connectionId || config.connectionId;
        if (!connId) return newConfig;

        try {
            const connMeta = await this.agentService.getConnection(connId);
            if (connMeta) {
                const tier = overrides.modelTier ?? 'optimal';
                const oldModel = config.model;
                newConfig.model = resolveModelForTier(connMeta, tier);
                if (overrides.connectionId) newConfig.connectionId = overrides.connectionId;

                // Sync thinking support from the newly resolved model
                const { enableThinking, reasoningEffort } =
                    this.resolveThinkingConfig(connMeta, tier, newConfig.model ?? '');
                newConfig.enableThinking = enableThinking;
                newConfig.reasoningEffort = reasoningEffort;

            }
        } catch (e) {
            log.error('Failed to re-resolve model', { connectionId: connId, error: e });
        }
        return newConfig;
    }

    /** Derive enableThinking and reasoningEffort from connection metadata + model supportsThinking flag. */
    private resolveThinkingConfig(
        connMeta: ConnectionMeta,
        tier: ModelTier,
        modelId: string,
    ): { enableThinking: boolean; reasoningEffort: 'low' | 'medium' | 'xhigh' | undefined } {
        const pid = connMeta.providerId ?? connMeta.provider;
        const cmData = connMeta.metadata as Record<string, unknown> | undefined;
        const tierThinking = cmData?.tierThinking as Record<string, boolean> | undefined;
        const tierOverride = tierThinking?.[tier];

        let enableThinking = false;
        if (pid && modelId) {
            const provider = this.agentService.getProvider(pid);
            const modelDef = provider?.models.find(m => m.id === modelId);
            // Per-tier override takes priority; fall back to model's supportsThinking default.
            enableThinking = tierOverride !== undefined ? tierOverride : !!modelDef?.supportsThinking;
        }

        return {
            enableThinking,
            reasoningEffort: cmData?.reasoningEffort as 'low' | 'medium' | 'xhigh' | undefined,
        };
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
