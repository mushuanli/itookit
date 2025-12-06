// @file llm-ui/orchestrator/ExecutorResolver.ts

import { IExecutor, LLMConnection, IAgentDefinition } from '@itookit/common';
import { IAgentService } from '../../services/IAgentService';
import { AgentExecutor } from './AgentExecutor';

/**
 * 解析后的执行器信息
 */
export interface ResolvedExecutor {
    /** 执行器实例 */
    executor: IExecutor;
    /** Agent 显示名称 */
    agentName: string;
    /** Agent 图标 */
    agentIcon: string;
    /** 元信息（用于 UI 显示和日志） */
    metaInfo: Record<string, any>;
}

/**
 * 执行器列表项
 */
export interface ExecutorListItem {
    id: string;
    name: string;
    icon: string;
    description?: string;
    category: string;
}

/**
 * 执行器解析器
 * 
 * 职责：
 * 1. 管理手动注册的执行器
 * 2. 根据 ID 解析并创建执行器实例
 * 3. 提供执行器列表供 UI 选择
 * 
 * 解析优先级：
 * 1. 注册表中的执行器（手动注册的自定义执行器）
 * 2. AgentService 中的 Agent 配置（从 .agent 文件加载）
 * 3. 默认执行器（使用默认连接）
 */
export class ExecutorResolver {
    /** 手动注册的执行器映射表 */
    private registry = new Map<string, IExecutor>();
    
    /** 缓存已解析的执行器（可选优化） */
    private resolveCache = new Map<string, { executor: ResolvedExecutor; timestamp: number }>();
    
    /** 缓存过期时间（毫秒） */
    private readonly CACHE_TTL = 60000; // 1 分钟

    constructor(private agentService: IAgentService) {}

    // ================================================================
    // 注册表管理
    // ================================================================

    /**
     * 注册自定义执行器
     * @param executor 执行器实例
     */
    register(executor: IExecutor): void {
        this.registry.set(executor.id, executor);
        // 清除该 ID 的缓存
        this.resolveCache.delete(executor.id);
    }

    /**
     * 注销执行器
     * @param id 执行器 ID
     */
    unregister(id: string): boolean {
        this.resolveCache.delete(id);
        return this.registry.delete(id);
    }

    /**
     * 获取已注册的执行器
     * @param id 执行器 ID
     */
    getRegistered(id: string): IExecutor | undefined {
        return this.registry.get(id);
    }

    /**
     * 检查执行器是否已注册
     * @param id 执行器 ID
     */
    isRegistered(id: string): boolean {
        return this.registry.has(id);
    }

    /**
     * 获取所有已注册的执行器 ID
     */
    getRegisteredIds(): string[] {
        return Array.from(this.registry.keys());
    }

    /**
     * 清空注册表
     */
    clear(): void {
        this.registry.clear();
        this.resolveCache.clear();
    }

    // ================================================================
    // 执行器解析
    // ================================================================

    /**
     * 解析执行器
     * 
     * 解析流程：
     * 1. 检查注册表
     * 2. 从 AgentService 加载配置并创建 AgentExecutor
     * 3. 返回 null 表示无法解析
     * 
     * @param executorId 执行器 ID
     * @param signal 可选的 AbortSignal，用于取消请求
     * @returns 解析后的执行器信息，或 null
     */
    async resolve(executorId: string, signal?: AbortSignal): Promise<ResolvedExecutor | null> {
        // 检查缓存
        const cached = this.getFromCache(executorId);
        if (cached) {
            return cached;
        }

        // 1. 先检查注册表
        const registered = this.registry.get(executorId);
        if (registered) {
            const result = this.wrapRegisteredExecutor(registered, executorId);
            this.addToCache(executorId, result);
            return result;
        }

        // 2. 从 AgentService 获取配置
        const fromAgent = await this.resolveFromAgentService(executorId, signal);
        if (fromAgent) {
            // 注意：AgentExecutor 包含 signal，不应长期缓存
            // 这里我们仍然缓存，但在实际使用时应考虑 signal 的有效性
            return fromAgent;
        }

        // 3. 无法解析
        return null;
    }

    /**
     * 解析执行器，如果失败则返回默认执行器
     * 
     * @param executorId 执行器 ID
     * @param signal 可选的 AbortSignal
     * @returns 解析后的执行器信息（保证非 null）
     * @throws 如果连默认执行器都无法创建
     */
    async resolveOrDefault(executorId: string, signal?: AbortSignal): Promise<ResolvedExecutor> {
        const resolved = await this.resolve(executorId, signal);
        if (resolved) {
            return resolved;
        }

        const defaultExecutor = await this.getDefault(signal);
        if (defaultExecutor) {
            return defaultExecutor;
        }

        throw new Error(`Cannot resolve executor "${executorId}" and no default connection available`);
    }

    /**
     * 获取默认执行器
     * 
     * @param signal 可选的 AbortSignal
     * @returns 默认执行器，或 null
     */
    async getDefault(signal?: AbortSignal): Promise<ResolvedExecutor | null> {
        try {
            const defaultConn = await this.agentService.getConnection('default');
            if (!defaultConn) {
                console.warn('[ExecutorResolver] No default connection configured');
                return null;
            }

            const executor = new AgentExecutor(
                defaultConn,
                defaultConn.model || '',
                undefined, // 无 system prompt
                signal
            );

            return {
                executor,
                agentName: 'Assistant',
                agentIcon: '🤖',
                metaInfo: {
                    agentId: 'default',
                    provider: defaultConn.provider,
                    connectionName: defaultConn.name,
                    model: defaultConn.model,
                    isDefault: true
                }
            };
        } catch (e) {
            console.error('[ExecutorResolver] Failed to create default executor:', e);
            return null;
        }
    }

    // ================================================================
    // 执行器列表
    // ================================================================

    /**
     * 获取所有可用的执行器列表
     * 
     * 用于 UI 中的执行器选择下拉框
     * 
     * @returns 执行器列表项数组
     */
    async getAvailableExecutors(): Promise<ExecutorListItem[]> {
        const list: ExecutorListItem[] = [];
        const addedIds = new Set<string>();

        // 1. 注册表中的执行器（优先级最高）
        for (const executor of this.registry.values()) {
            const item = this.executorToListItem(executor, 'Custom');
            list.push(item);
            addedIds.add(executor.id);
        }

        // 2. AgentService 中的 Agent 配置
        try {
            const fileAgents = await this.agentService.getAgents();
            
            for (const agent of fileAgents) {
                // 避免重复
                if (addedIds.has(agent.id)) {
                    continue;
                }

                list.push({
                    id: agent.id,
                    name: agent.name,
                    icon: agent.icon || '🤖',
                    description: agent.description,
                    category: this.categorizeAgent(agent)
                });
                addedIds.add(agent.id);
            }
        } catch (e) {
            console.warn('[ExecutorResolver] Failed to load agents from service:', e);
        }

        // 3. 确保默认执行器始终存在
        if (!addedIds.has('default')) {
            list.unshift({
                id: 'default',
                name: 'Default Assistant',
                icon: '🤖',
                description: 'Uses the default connection',
                category: 'System'
            });
        }

        return list;
    }

    /**
     * 按分类获取执行器列表
     * 
     * @returns 分类后的执行器映射
     */
    async getExecutorsByCategory(): Promise<Map<string, ExecutorListItem[]>> {
        const all = await this.getAvailableExecutors();
        const categoryMap = new Map<string, ExecutorListItem[]>();

        for (const item of all) {
            const category = item.category || 'Other';
            if (!categoryMap.has(category)) {
                categoryMap.set(category, []);
            }
            categoryMap.get(category)!.push(item);
        }

        // 排序：System > Custom > Agents > Other
        const orderedMap = new Map<string, ExecutorListItem[]>();
        const order = ['System', 'Custom', 'Agents', 'Tools', 'Workflows'];
        
        for (const cat of order) {
            if (categoryMap.has(cat)) {
                orderedMap.set(cat, categoryMap.get(cat)!);
                categoryMap.delete(cat);
            }
        }
        
        // 添加剩余分类
        for (const [cat, items] of categoryMap) {
            orderedMap.set(cat, items);
        }

        return orderedMap;
    }

    /**
     * 搜索执行器
     * 
     * @param query 搜索关键词
     * @returns 匹配的执行器列表
     */
    async searchExecutors(query: string): Promise<ExecutorListItem[]> {
        if (!query || query.trim().length === 0) {
            return this.getAvailableExecutors();
        }

        const all = await this.getAvailableExecutors();
        const lowerQuery = query.toLowerCase().trim();

        return all.filter(item => {
            return (
                item.id.toLowerCase().includes(lowerQuery) ||
                item.name.toLowerCase().includes(lowerQuery) ||
                (item.description?.toLowerCase().includes(lowerQuery) ?? false) ||
                item.category.toLowerCase().includes(lowerQuery)
            );
        });
    }

    // ================================================================
    // 私有辅助方法
    // ================================================================

    /**
     * 从 AgentService 解析执行器
     */
    private async resolveFromAgentService(
        executorId: string,
        signal?: AbortSignal
    ): Promise<ResolvedExecutor | null> {
        try {
            const agentDef = await this.agentService.getAgentConfig(executorId);

            if (!agentDef) {
                return null;
            }

            // 检查是否有有效的配置
            if (!agentDef.config) {
                console.warn(`[ExecutorResolver] Agent "${executorId}" has no config`);
                return null;
            }

            // 获取连接配置
            const connectionId = agentDef.config.connectionId;
            if (!connectionId) {
                console.warn(`[ExecutorResolver] Agent "${executorId}" has no connectionId`);
                return null;
            }

            const connection = await this.agentService.getConnection(connectionId);
            if (!connection) {
                console.warn(`[ExecutorResolver] Connection "${connectionId}" not found for agent "${executorId}"`);
                return null;
            }

            // 创建执行器
            const modelId = agentDef.config.modelId || connection.model;
            const systemPrompt = agentDef.config.systemPrompt;

            const executor = new AgentExecutor(
                connection,
                modelId,
                systemPrompt,
                signal
            );

            return {
                executor,
                agentName: agentDef.name || 'Assistant',
                agentIcon: agentDef.icon || '🤖',
                metaInfo: {
                    agentId: executorId,
                    agentDescription: agentDef.description,
                    provider: connection.provider,
                    connectionId: connection.id,
                    connectionName: connection.name,
                    model: modelId,
                    hasSystemPrompt: !!systemPrompt,
                    tags: (agentDef as any).tags
                }
            };
        } catch (e) {
            console.warn(`[ExecutorResolver] Failed to resolve agent "${executorId}":`, e);
            return null;
        }
    }

    /**
     * 包装已注册的执行器
     */
    private wrapRegisteredExecutor(executor: IExecutor, id: string): ResolvedExecutor {
        // 尝试从执行器中提取额外信息
        const anyExecutor = executor as any;

        return {
            executor,
            agentName: anyExecutor.name || anyExecutor.config?.name || id,
            agentIcon: anyExecutor.icon || anyExecutor.config?.icon || '🔧',
            metaInfo: {
                agentId: id,
                type: executor.type,
                isRegistered: true,
                category: anyExecutor.category || 'Custom',
                description: anyExecutor.description
            }
        };
    }

    /**
     * 将执行器转换为列表项
     */
    private executorToListItem(executor: IExecutor, defaultCategory: string): ExecutorListItem {
        const anyExecutor = executor as any;

        return {
            id: executor.id,
            name: anyExecutor.name || executor.id,
            icon: anyExecutor.icon || '🔧',
            description: anyExecutor.description,
            category: anyExecutor.category || defaultCategory
        };
    }

    /**
     * 根据 Agent 定义确定分类
     */
    private categorizeAgent(agent: IAgentDefinition): string {
        // 根据 agent 的属性或标签确定分类
        const anyAgent = agent as any;

        // 检查标签
        if (anyAgent.tags) {
            if (anyAgent.tags.includes('tool')) return 'Tools';
            if (anyAgent.tags.includes('workflow')) return 'Workflows';
            if (anyAgent.tags.includes('system')) return 'System';
        }

        // 检查类型
        if (agent.type === 'tool') return 'Tools';
        if (agent.type === 'workflow') return 'Workflows';

        // 默认分类
        return 'Agents';
    }

    // ================================================================
    // 缓存管理
    // ================================================================

    /**
     * 从缓存获取
     */
    private getFromCache(id: string): ResolvedExecutor | null {
        const cached = this.resolveCache.get(id);
        if (!cached) {
            return null;
        }

        // 检查是否过期
        const now = Date.now();
        if (now - cached.timestamp > this.CACHE_TTL) {
            this.resolveCache.delete(id);
            return null;
        }

        return cached.executor;
    }

    /**
     * 添加到缓存
     */
    private addToCache(id: string, executor: ResolvedExecutor): void {
        this.resolveCache.set(id, {
            executor,
            timestamp: Date.now()
        });
    }

    /**
     * 清除过期缓存
     */
    clearExpiredCache(): void {
        const now = Date.now();
        for (const [id, cached] of this.resolveCache) {
            if (now - cached.timestamp > this.CACHE_TTL) {
                this.resolveCache.delete(id);
            }
        }
    }

    /**
     * 清除指定执行器的缓存
     */
    invalidateCache(id: string): void {
        this.resolveCache.delete(id);
    }

    /**
     * 清除所有缓存
     */
    clearAllCache(): void {
        this.resolveCache.clear();
    }

    // ================================================================
    // 验证与检查
    // ================================================================

    /**
     * 检查执行器是否可用
     * 
     * @param executorId 执行器 ID
     * @returns 是否可用
     */
    async isAvailable(executorId: string): Promise<boolean> {
        // 检查注册表
        if (this.registry.has(executorId)) {
            return true;
        }

        // 检查 AgentService
        try {
            const agentDef = await this.agentService.getAgentConfig(executorId);
            if (!agentDef?.config?.connectionId) {
                return false;
            }

            const connection = await this.agentService.getConnection(agentDef.config.connectionId);
            return !!connection;
        } catch {
            return false;
        }
    }

    /**
     * 验证执行器配置
     * 
     * @param executorId 执行器 ID
     * @returns 验证结果
     */
    async validate(executorId: string): Promise<{
        valid: boolean;
        errors: string[];
        warnings: string[];
    }> {
        const errors: string[] = [];
        const warnings: string[] = [];

        // 检查注册表
        if (this.registry.has(executorId)) {
            return { valid: true, errors, warnings };
        }

        // 检查 AgentService
        try {
            const agentDef = await this.agentService.getAgentConfig(executorId);
            
            if (!agentDef) {
                errors.push(`Agent "${executorId}" not found`);
                return { valid: false, errors, warnings };
            }

            if (!agentDef.config) {
                errors.push('Agent has no configuration');
                return { valid: false, errors, warnings };
            }

            if (!agentDef.config.connectionId) {
                errors.push('Agent has no connectionId configured');
                return { valid: false, errors, warnings };
            }

            const connection = await this.agentService.getConnection(agentDef.config.connectionId);
            
            if (!connection) {
                errors.push(`Connection "${agentDef.config.connectionId}" not found`);
                return { valid: false, errors, warnings };
            }

            // 检查 API Key
            if (!connection.apiKey) {
                warnings.push('Connection has no API key configured');
            }

            // 检查模型
            if (!agentDef.config.modelId && !connection.model) {
                warnings.push('No model specified, will use connection default');
            }

            // 检查 System Prompt
            if (!agentDef.config.systemPrompt) {
                warnings.push('No system prompt configured');
            }

            return { valid: true, errors, warnings };
        } catch (e: any) {
            errors.push(`Validation failed: ${e.message}`);
            return { valid: false, errors, warnings };
        }
    }

    // ================================================================
    // 批量操作
    // ================================================================

    /**
     * 批量解析执行器
     * 
     * @param executorIds 执行器 ID 列表
     * @param signal 可选的 AbortSignal
     * @returns 解析结果映射
     */
    async resolveMany(
        executorIds: string[],
        signal?: AbortSignal
    ): Promise<Map<string, ResolvedExecutor | null>> {
        const results = new Map<string, ResolvedExecutor | null>();

        // 并发解析，但限制并发数
        const BATCH_SIZE = 5;
        
        for (let i = 0; i < executorIds.length; i += BATCH_SIZE) {
            if (signal?.aborted) {
                break;
            }

            const batch = executorIds.slice(i, i + BATCH_SIZE);
            const promises = batch.map(id => this.resolve(id, signal));
            const resolved = await Promise.all(promises);

            batch.forEach((id, index) => {
                results.set(id, resolved[index]);
            });
        }

        return results;
    }

    /**
     * 批量验证执行器
     * 
     * @param executorIds 执行器 ID 列表
     * @returns 验证结果映射
     */
    async validateMany(executorIds: string[]): Promise<Map<string, {
        valid: boolean;
        errors: string[];
        warnings: string[];
    }>> {
        const results = new Map();

        for (const id of executorIds) {
            const result = await this.validate(id);
            results.set(id, result);
        }

        return results;
    }

    // ================================================================
    // 连接管理辅助
    // ================================================================

    /**
     * 获取执行器使用的连接信息
     * 
     * @param executorId 执行器 ID
     * @returns 连接信息，或 null
     */
    async getConnectionForExecutor(executorId: string): Promise<{
        connectionId: string;
        connectionName: string;
        provider: string;
        model: string;
    } | null> {
        // 检查注册表中的执行器（可能不依赖连接）
        if (this.registry.has(executorId)) {
            return null;
        }

        try {
            const agentDef = await this.agentService.getAgentConfig(executorId);
            if (!agentDef?.config?.connectionId) {
                return null;
            }

            const connection = await this.agentService.getConnection(agentDef.config.connectionId);
            if (!connection) {
                return null;
            }

            return {
                connectionId: connection.id,
                connectionName: connection.name,
                provider: connection.provider,
                model: agentDef.config.modelId || connection.model || ''
            };
        } catch {
            return null;
        }
    }

    /**
     * 获取使用指定连接的所有执行器
     * 
     * @param connectionId 连接 ID
     * @returns 执行器 ID 列表
     */
    async getExecutorsByConnection(connectionId: string): Promise<string[]> {
        const executorIds: string[] = [];

        try {
            const agents = await this.agentService.getAgents();
            
            for (const agent of agents) {
                if (agent.config?.connectionId === connectionId) {
                    executorIds.push(agent.id);
                }
            }
        } catch (e) {
            console.warn('[ExecutorResolver] Failed to get executors by connection:', e);
        }

        return executorIds;
    }

    // ================================================================
    // 调试与诊断
    // ================================================================

    /**
     * 获取解析器状态信息
     */
    getStatus(): {
        registeredCount: number;
        cacheSize: number;
        registeredIds: string[];
    } {
        return {
            registeredCount: this.registry.size,
            cacheSize: this.resolveCache.size,
            registeredIds: Array.from(this.registry.keys())
        };
    }

    /**
     * 打印调试信息
     */
    debug(): void {
        console.group('[ExecutorResolver] Debug Info');
        console.log('Registered Executors:', Array.from(this.registry.keys()));
        console.log('Cache Size:', this.resolveCache.size);
        console.log('Cache Entries:', Array.from(this.resolveCache.keys()));
        console.groupEnd();
    }
}
