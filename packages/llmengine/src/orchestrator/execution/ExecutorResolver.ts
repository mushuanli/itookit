// @file llm-engine/orchestrator/ExecutorResolver.ts

import { 
    IExecutor, 
    IAgentDefinition,
    ExecutorConfig
} from '@itookit/common';
import { IAgentService } from '../../services/IAgentService';

// ✨ [关键变更] 从 llmdriver 导入通用的 AgentExecutor
import { LLMConnection, AgentExecutor } from '@itookit/llmdriver';

// ✨ [关键变更] 导入 UnifiedExecutor (本地编排逻辑)
import { UnifiedExecutor } from './UnifiedExecutor';

/**
 * 解析后的执行器信息
 */
export interface ResolvedExecutor {
    executor: IExecutor;
    agentName: string;
    agentIcon: string;
    metaInfo: Record<string, any>;
}

export interface ExecutorListItem {
    id: string;
    name: string;
    icon: string;
    description?: string;
    category: string;
}

/**
 * 执行器解析工厂
 * 职责：
 * 1. 访问 IAgentService 获取配置和 API Key
 * 2. 实例化 AgentExecutor (LLM 调用) 或 UnifiedExecutor (编排)
 * 3. 缓存实例
 */
export class ExecutorResolver {
    private registry = new Map<string, IExecutor>();
    private resolveCache = new Map<string, { executor: ResolvedExecutor; timestamp: number }>();
    private readonly CACHE_TTL = 60000; // 1 分钟

    constructor(private agentService: IAgentService) {}

    /**
     * 解析执行器
     */
    async resolve(executorId: string, signal?: AbortSignal): Promise<ResolvedExecutor | null> {
        // 1. 检查缓存
        const cached = this.getFromCache(executorId);
        if (cached) return cached;

        // 2. 检查手动注册表
        const registered = this.registry.get(executorId);
        if (registered) {
            return this.wrapRegisteredExecutor(registered, executorId);
        }

        // 3. 从 AgentService 解析配置
        const fromService = await this.resolveFromService(executorId, signal);
        if (fromService) {
            // 缓存结果 (注意：signal 绑定的 executor 不应长期缓存，这里简化处理)
            this.addToCache(executorId, fromService);
            return fromService;
        }

        return null;
    }

    /**
     * 获取默认执行器
     */
    async getDefault(signal?: AbortSignal): Promise<ResolvedExecutor | null> {
        try {
            const defaultConn = await this.agentService.getConnection('default');
            if (!defaultConn) return null;

            return this.createAgentExecutor(defaultConn, {
                id: 'default',
                name: 'Assistant',
                icon: '🤖',
                isDefault: true
            });
        } catch (e) {
            console.error('[ExecutorResolver] Failed to create default executor:', e);
            return null;
        }
    }

    /**
     * 核心工厂方法：创建 UnifiedExecutor 并注入 Factory
     * 这使得 UnifiedExecutor 在执行时可以递归解析子节点，而无需知道 AgentExecutor 的存在
     */
    createUnifiedExecutor(config: ExecutorConfig): IExecutor {
        // 注入 factory 闭包
        const childFactory = (childConfig: ExecutorConfig): IExecutor => {
            if (childConfig.type === 'atomic') {
                // 如果子节点是 atomic，但我们只有 config 没有 connection 信息，
                // 这里其实是一个潜在问题。
                // 通常 UnifiedExecutor 的 children 引用的是 ID。
                // 如果 config 是内嵌的完整配置，我们需要在这里处理。
                // *简化实现*：假设 UnifiedExecutor 的 children 主要是通过 ID 引用的，
                // 或者我们在这里抛出错误，要求 Atomic 节点必须通过 ID 解析。
                throw new Error("Embedded atomic config not fully supported in factory yet. Use referenced ID.");
            }
            // 递归创建
            return this.createUnifiedExecutor(childConfig);
        };

        return new UnifiedExecutor(config, childFactory);
    }

    // ================================================================
    // 私有工厂方法
    // ================================================================

    private async resolveFromService(executorId: string, signal?: AbortSignal): Promise<ResolvedExecutor | null> {
        try {
            const agentDef = await this.agentService.getAgentConfig(executorId);
            if (!agentDef || !agentDef.config) return null;

            // Case A: Atomic Agent
            if (agentDef.type === 'agent' || agentDef.type === 'tool') {
                const connId = agentDef.config.connectionId;
                if (!connId) return null;

                const connection = await this.agentService.getConnection(connId);
                if (!connection) return null;

                return this.createAgentExecutor(connection, {
                    id: executorId,
                    name: agentDef.name,
                    icon: agentDef.icon || '🤖',
                    model: agentDef.config.modelId,
                    systemPrompt: agentDef.config.systemPrompt,
                    description: agentDef.description,
                    tags: agentDef.tags
                });
            }

            // Case B: Composite (Workflow/Orchestrator)
            // TODO: 实现从配置加载 UnifiedExecutor 的逻辑
            // const executor = this.createUnifiedExecutor(agentDef.config as any);
            // return { ... };

            return null;
        } catch (e) {
            console.warn(`[ExecutorResolver] Failed to resolve ${executorId}`, e);
            return null;
        }
    }

    private createAgentExecutor(
        conn: LLMConnection, 
        options: { 
            id: string; 
            name: string; 
            icon: string; 
            model?: string; 
            systemPrompt?: string;
            description?: string;
            isDefault?: boolean;
            tags?: string[];
        }
    ): ResolvedExecutor {
        // ✨ [关键] 实例化 llmdriver 中的 AgentExecutor
        const executor = new AgentExecutor({
            id: options.id,
            name: options.name,
            connection: conn,
            model: options.model || conn.model,
            systemPrompt: options.systemPrompt
        });

        return {
            executor,
            agentName: options.name,
            agentIcon: options.icon,
            metaInfo: {
                agentId: options.id,
                description: options.description,
                provider: conn.provider,
                connectionName: conn.name,
                model: options.model || conn.model,
                isDefault: options.isDefault,
                tags: options.tags
            }
        };
    }

    // ================================================================
    // 列表与缓存管理
    // ================================================================

    async getAvailableExecutors(): Promise<ExecutorListItem[]> {
        const list: ExecutorListItem[] = [];
        const addedIds = new Set<string>();

        // 1. Registered
        for (const executor of this.registry.values()) {
            list.push(this.executorToListItem(executor, 'Custom'));
            addedIds.add(executor.id);
        }

        // 2. File-based Agents
        try {
            const agents = await this.agentService.getAgents();
            for (const agent of agents) {
                if (addedIds.has(agent.id)) continue;
                list.push({
                    id: agent.id,
                    name: agent.name,
                    icon: agent.icon || '🤖',
                    description: agent.description,
                    category: this.categorizeAgent(agent)
                });
                addedIds.add(agent.id);
            }
        } catch (e) { console.warn('Failed to load agents', e); }

        // 3. Default
        if (!addedIds.has('default')) {
            list.unshift({
                id: 'default',
                name: 'Default Assistant',
                icon: '🤖',
                description: 'Uses default connection',
                category: 'System'
            });
        }
        return list;
    }

    private wrapRegisteredExecutor(executor: IExecutor, id: string): ResolvedExecutor {
        const anyEx = executor as any;
        return {
            executor,
            agentName: anyEx.name || id,
            agentIcon: anyEx.icon || '🔧',
            metaInfo: { agentId: id, isRegistered: true }
        };
    }

    private executorToListItem(executor: IExecutor, category: string): ExecutorListItem {
        const anyEx = executor as any;
        return {
            id: executor.id,
            name: anyEx.name || executor.id,
            icon: anyEx.icon || '🔧',
            description: anyEx.description,
            category: anyEx.category || category
        };
    }

    private categorizeAgent(agent: IAgentDefinition): string {
        if (agent.tags?.includes('tool')) return 'Tools';
        if (agent.tags?.includes('workflow')) return 'Workflows';
        if (agent.type === 'tool') return 'Tools';
        return 'Agents';
    }

    private getFromCache(id: string): ResolvedExecutor | null {
        const cached = this.resolveCache.get(id);
        if (!cached) return null;
        if (Date.now() - cached.timestamp > this.CACHE_TTL) {
            this.resolveCache.delete(id);
            return null;
        }
        return cached.executor;
    }

    private addToCache(id: string, executor: ResolvedExecutor) {
        this.resolveCache.set(id, { executor, timestamp: Date.now() });
    }
}
