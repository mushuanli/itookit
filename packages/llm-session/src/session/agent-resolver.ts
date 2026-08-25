// @file: llm-conversation/session/agent-resolver.ts

import { ExecutorConfig } from '../core/types';
import { resolveModelForTier, ModelTier, resolveWebSearchStrategy } from '@itookit/common';
import type { ConnectionMeta, WebSearchMode } from '@itookit/common';
import { IAgentConfigService } from '../services/agent-service';
import { ConversationError, ConversationErrorCode } from '../core/errors';
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
            if (e instanceof ConversationError) throw e;
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
     * Throws if agent or version is not found. Used by Kernel where
     * silent fallback would mask configuration errors.
     */
    async resolveExact(agentId: string, version?: string): Promise<ExecutorConfig> {
        const agentDef = await this.agentService.getAgentConfig(agentId);

        if (!agentDef) {
            throw new ConversationError(
                ConversationErrorCode.AGENT_NOT_FOUND,
                `Agent not found: ${agentId}. Kernel requires exact agent resolution.`,
            );
        }

        if (version && (!agentDef.version || agentDef.version !== version)) {
            throw new ConversationError(
                ConversationErrorCode.AGENT_NOT_FOUND,
                `Agent version mismatch: requested ${version ?? '(missing)'}, found ${agentDef.version ?? '(unversioned)'}`,
            );
        }

        return this.buildConfig(agentDef);
    }

    /** Resolve a System Prompt library entry by id. */
    async getSystemPrompt(id: string): Promise<import('@itookit/common').SystemPromptDefinition | null> {
        return this.agentService.getSystemPrompt(id);
    }

    /** Resolve enabled static Skills in declaration order. */
    async getSkills(ids: string[]): Promise<import('@itookit/common').LLMSkill[]> {
        if (!ids.length) return [];
        const byId = new Map((await this.agentService.getSkills()).map(skill => [skill.id, skill]));
        return ids.map(id => byId.get(id)).filter((skill): skill is import('@itookit/common').LLMSkill => Boolean(skill?.enabled));
    }

    /** Build ExecutorConfig from an AgentDefinition. */
    private async buildConfig(agentDef: import('@itookit/common').AgentDefinition): Promise<ExecutorConfig> {
        const connId = agentDef.modelPolicy?.connectionId ?? agentDef.config.connectionId;
        log.debug('buildConfig resolving agent', {
            agentId: agentDef.id,
            agentName: agentDef.name,
            modelPolicyConnId: agentDef.modelPolicy?.connectionId,
            configConnId: agentDef.config.connectionId,
            resolvedConnId: connId,
        });
        const connMeta = await this.agentService.getConnection(connId);

        if (!connMeta) {
            throw new ConversationError(
                ConversationErrorCode.AGENT_NOT_FOUND,
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

        const webSearchMode = this.resolveWebSearch(connMeta);

        // Resolve system prompt: prefer a shared System Prompt library entry
        // (systemPromptId) over the inline config.systemPrompt.
        let systemPromptSegments: string[] = [];
        if (agentDef.config.systemPromptId) {
            const sp = await this.agentService.getSystemPrompt(agentDef.config.systemPromptId);
            if (sp?.content?.length) systemPromptSegments = [...sp.content];
        }
        if (!systemPromptSegments.length) {
            systemPromptSegments = [agentDef.systemPrompt ?? agentDef.config.systemPrompt]
                .filter((s): s is string => Boolean(s));
        }

        return {
            id: agentDef.id,
            name: agentDef.name,
            type: 'agent',
            connectionId: connId,
            model: modelId,
            enableThinking: agentDef.modelPolicy?.thinking ?? enableThinking,
            reasoningEffort: agentDef.modelPolicy?.reasoningEffort ?? reasoningEffort,
            webSearchMode,
            systemPrompt: systemPromptSegments,
            icon: agentDef.icon,
            temperature: agentDef.modelPolicy?.temperature ?? agentDef.config.temperature,
            agentVersion: agentDef.version ?? await this.hashDefinition(agentDef),
            capabilityPolicy: agentDef.capabilityPolicy,
            memoryPolicy: agentDef.memoryPolicy,
            defaultContextPolicy: agentDef.defaultContextPolicy,
        } as ExecutorConfig;
    }

    private async hashDefinition(agentDef: import('@itookit/common').AgentDefinition): Promise<string> {
        const canonical = this.canonicalize({
            ...agentDef,
            version: undefined,
            modifiedAt: undefined,
        });
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
        return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }

    private canonicalize(value: unknown): string {
        if (Array.isArray(value)) return `[${value.map(item => this.canonicalize(item)).join(',')}]`;
        if (value && typeof value === 'object') {
            const record = value as Record<string, unknown>;
            return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
                .map(key => `${JSON.stringify(key)}:${this.canonicalize(record[key])}`).join(',')}}`;
        }
        return JSON.stringify(value);
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
            log.error('getModelsForAgent failed', { agentId, error: e });
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
    ): { enableThinking: boolean; reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | undefined } {
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
            reasoningEffort: cmData?.reasoningEffort as 'low' | 'medium' | 'high' | 'xhigh' | undefined,
        };
    }

    /**
     * 解析联网搜索策略三态：provider 支持内置 server-side search 且当前协议可用
     * 则走底层（'builtin'），否则依赖客户端统一工具（'client-tool'）。
     * 返回判别联合（非两个布尔），杜绝「内置+客户端」非法态。
     */
    private resolveWebSearch(
        connMeta: ConnectionMeta,
        enabled = true,
    ): WebSearchMode {
        const provider = this.agentService.getProvider(connMeta.providerId);
        return resolveWebSearchStrategy(provider?.capabilities, enabled, connMeta.protocol);
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
