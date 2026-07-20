// @file: llm-engine/session/agent-resolver.ts

import { ExecutorConfig } from '../core/types';
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

    /**
     * Resolve agent for chat — falls back to Default Agent if not found.
     * This is the standard chat path where users may not have configured an agent.
     */
    async resolve(agentId: string): Promise<ExecutorConfig> {
        return this.resolveForChat(agentId);
    }

    /**
     * Resolve agent for chat — uses Default Agent fallback on missing agent.
     */
    async resolveForChat(agentId: string): Promise<ExecutorConfig> {
        let config: ExecutorConfig | null = null;

        try {
            const agentDef = await this.agentService.getAgentConfig(agentId);

            if (agentDef) {
                config = await this.buildConfig(agentDef);
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

    /**
     * Resolve agent exactly — no fallback.
     * Throws if agent or version is not found. Used by Harness where
     * silent fallback would mask configuration errors.
     */
    async resolveExact(agentId: string, version?: string): Promise<ExecutorConfig> {
        const agentDef = await this.agentService.getAgentConfig(agentId);

        if (!agentDef) {
            throw new EngineError(
                EngineErrorCode.EXECUTOR_NOT_FOUND,
                `Agent not found: ${agentId}. Harness requires exact agent resolution.`,
            );
        }

        if (version && agentDef.version && agentDef.version !== version) {
            throw new EngineError(
                EngineErrorCode.EXECUTOR_NOT_FOUND,
                `Agent version mismatch: requested ${version}, found ${agentDef.version}`,
            );
        }

        return this.buildConfig(agentDef);
    }

    /** Build ExecutorConfig from an AgentDefinition. */
    private async buildConfig(agentDef: import('@itookit/common').AgentDefinition): Promise<ExecutorConfig> {
        const connId = agentDef.modelPolicy?.connectionId ?? agentDef.config.connectionId;
        console.log('[AgentResolver] buildConfig resolving agent', {
            agentId: agentDef.id,
            agentName: agentDef.name,
            modelPolicyConnId: agentDef.modelPolicy?.connectionId,
            configConnId: agentDef.config.connectionId,
            resolvedConnId: connId,
        });
        const connMeta = await this.agentService.getConnection(connId);

        if (!connMeta) {
            throw new EngineError(
                EngineErrorCode.EXECUTOR_NOT_FOUND,
                `Connection '${connId}' for agent '${agentDef.name}' not found.`,
            );
        }

        const tier = agentDef.modelPolicy?.modelTier ?? agentDef.config.modelTier ?? 'optimal';
        const modelId = agentDef.modelPolicy?.modelName
            ?? agentDef.config.modelName
            ?? resolveModelForTier(connMeta, tier)
            ?? '';

        const { enableThinking, reasoningEffort } =
            this.resolveThinkingConfig(connMeta, tier, modelId);

        return {
            id: agentDef.id,
            name: agentDef.name,
            type: 'agent',
            connectionId: connId,
            model: modelId,
            enableThinking: agentDef.modelPolicy?.thinking ?? enableThinking,
            reasoningEffort: agentDef.modelPolicy?.reasoningEffort ?? reasoningEffort,
            systemPrompt: agentDef.systemPrompt ?? agentDef.config.systemPrompt,
            icon: agentDef.icon,
            temperature: agentDef.modelPolicy?.temperature ?? agentDef.config.temperature,
        } as ExecutorConfig;
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
     * 记录一次 LLM 用量到 cost.seq（按 sessionId|providerId|date 累加）。
     */
    async recordUsageCost(
        connectionId: string,
        sessionId: string,
        usage: {
            inputTokens: number;
            outputTokens: number;
            cost: number;
            cacheWriteTokens?: number;
            cacheReadTokens?: number;
        },
    ): Promise<void> {
        if (!connectionId) return;
        try {
            const connMeta = await this.agentService.getConnection(connectionId);
            if (!connMeta) return;
            const svc = this.agentService as unknown as {
                recordCost?(p: unknown): Promise<void>;
            };
            await svc.recordCost?.({
                sessionId,
                providerId:   connMeta.providerId,
                connectionId,
                modelId:      connMeta.model,
                usage,
            });
        } catch (e) {
            log.error('Failed to record usage cost', { connectionId, sessionId, error: e });
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
                newConfig.model = resolveModelForTier(connMeta, tier);
                if (overrides.connectionId) newConfig.connectionId = overrides.connectionId;

                // Sync thinking support from the newly resolved model
                const { enableThinking, reasoningEffort } =
                    this.resolveThinkingConfig(connMeta, tier, newConfig.model ?? '');
                newConfig.enableThinking = enableThinking;
                newConfig.reasoningEffort = reasoningEffort;

                log.info('reResolveModel: model resolved for override connection', {
                    connectionId: connId,
                    model: newConfig.model,
                    tier,
                });
            } else {
                log.warn('reResolveModel: override connection not found, keeping original', {
                    connectionId: connId,
                });
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
        const pid = connMeta.providerId;
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
