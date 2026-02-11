// @file: llm-engine/helper/ExecutorConfigResolver.ts

import { ExecutorConfig } from '@itookit/llm-kernel';
import { IAgentService } from '../services/agent-service';

/**
 * 执行器配置解析选项
 */
export interface ExecutorConfigResolverOptions {
    /** 是否启用模型 ID 缓存 */
    enableCache?: boolean;
    /** 缓存过期时间（毫秒），0 表示永不过期 */
    cacheExpiry?: number;
}

/**
 * 模型解析结果
 */
export interface ModelResolutionResult {
    /** 解析后的模型 ID */
    modelId: string;
    /** 是否来自缓存 */
    fromCache: boolean;
    /** 原始模型名称 */
    originalName: string;
}

/**
 * 执行器配置解析器
 * 
 * 职责：
 * - 从 AgentService 获取 Agent 配置
 * - 解析模型名称到模型 ID（带缓存）
 * - 提供健壮的回退机制
 * - 管理缓存生命周期
 */
export class ExecutorConfigResolver {
    private modelResolutionCache = new Map<string, {
        modelId: string;
        timestamp: number;
    }>();

    private options: Required<ExecutorConfigResolverOptions>;

    constructor(
        private agentService: IAgentService,
        options: ExecutorConfigResolverOptions = {}
    ) {
        this.options = {
            enableCache: options.enableCache ?? true,
            cacheExpiry: options.cacheExpiry ?? 0 // 默认永不过期
        };

        // 监听 AgentService 变更，清空缓存
        this.agentService.onChange(() => {
            this.clearCache();
        });
    }

    /**
     * 解析执行器配置
     * 
     * @param executorId 执行器 ID
     * @returns 执行器配置
     */
    async resolve(executorId: string): Promise<ExecutorConfig> {
        try {
            // 1. 尝试从 AgentService 获取
            const agentDef = await this.agentService.getAgentConfig(executorId);

            if (agentDef) {
                // 2. 获取连接信息
                const connection = await this.agentService.getConnection(
                    agentDef.config.connectionId
                );

                if (!connection) {
                    console.warn(
                        `[ExecutorConfigResolver] Connection '${agentDef.config.connectionId}' not found for agent '${agentDef.name}'`
                    );
                    return this.getFallbackConfig();
                }

                // 3. 解析模型 ID
                const modelResolution = this.resolveModelId(
                    connection,
                    agentDef.config.modelName
                );

                // 4. 构建配置
                return {
                    id: agentDef.id,
                    name: agentDef.name,
                    type: agentDef.type === 'agent' ? 'agent' : 'composite',
                    connection,
                    model: modelResolution.modelId,
                    systemPrompt: agentDef.config.systemPrompt
                } as ExecutorConfig;
            }

        } catch (e) {
            console.warn(
                `[ExecutorConfigResolver] Failed to resolve executor ${executorId}:`,
                e
            );
        }

        // 回退到默认配置
        return this.getFallbackConfig();
    }

    /**
     * 解析模型 ID（带缓存）
     * 
     * 策略：
     * 1. 如果 modelName 为空，使用 connection 的第一个模型
     * 2. 优先匹配 name 字段（因为 modelName 通常是显示名称）
     * 3. 如果 name 没匹配上，检查是否本身就是有效的 ID
     * 4. 都不匹配则使用第一个模型作为回退
     * 
     * @param connection 连接配置
     * @param modelName 模型名称
     * @returns 模型解析结果
     */
    resolveModelId(
        connection: any,
        modelName: string | undefined
    ): ModelResolutionResult {
        const cacheKey = `${connection.id}:${modelName || ''}`;

        // 1. 检查缓存
        if (this.options.enableCache) {
            const cached = this.modelResolutionCache.get(cacheKey);
            if (cached) {
                // 检查是否过期
                if (
                    this.options.cacheExpiry === 0 ||
                    Date.now() - cached.timestamp < this.options.cacheExpiry
                ) {
                    return {
                        modelId: cached.modelId,
                        fromCache: true,
                        originalName: modelName || ''
                    };
                } else {
                    // 缓存过期，删除
                    this.modelResolutionCache.delete(cacheKey);
                }
            }
        }

        // 2. 执行解析逻辑
        let resolvedId = modelName || ''; // 默认 fallback

        if (connection.availableModels && Array.isArray(connection.availableModels)) {
            const firstModelId = connection.availableModels[0]?.id || '';

            // 如果 modelName 为空，使用第一个模型
            if (!modelName) {
                resolvedId = firstModelId;
            } else {
                // 优先匹配 Name（显示名称）
                const matchedByName = connection.availableModels.find(
                    (m: any) => m.name === modelName
                );

                if (matchedByName) {
                    resolvedId = matchedByName.id;
                } else {
                    // 检查是否本身就是有效的 ID
                    const matchedById = connection.availableModels.find(
                        (m: any) => m.id === modelName
                    );

                    if (matchedById) {
                        resolvedId = matchedById.id;
                    } else {
                        // 都不匹配，使用第一个模型
                        resolvedId = firstModelId;
                        console.warn(
                            `[ExecutorConfigResolver] Model "${modelName}" not found in connection "${connection.id}", using fallback: ${firstModelId}`
                        );
                    }
                }
            }
        }

        // 3. 写入缓存
        if (this.options.enableCache) {
            this.modelResolutionCache.set(cacheKey, {
                modelId: resolvedId,
                timestamp: Date.now()
            });
        }

        return {
            modelId: resolvedId,
            fromCache: false,
            originalName: modelName || ''
        };
    }

    /**
     * 获取回退配置
     * 
     * 策略：
     * 1. 尝试获取默认连接
     * 2. 如果没有连接，返回错误配置
     * 3. 使用连接的第一个模型
     */
    private async getFallbackConfig(): Promise<ExecutorConfig> {
        const fallbackConnection = await this.agentService.getDefaultConnection();

        if (!fallbackConnection) {
            console.error('[ExecutorConfigResolver] CRITICAL: No connections available.');

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
     * 批量解析执行器配置
     * 
     * @param executorIds 执行器 ID 列表
     * @returns 配置列表
     */
    async resolveMany(executorIds: string[]): Promise<ExecutorConfig[]> {
        const promises = executorIds.map(id => this.resolve(id));
        return Promise.all(promises);
    }

    /**
     * 预热缓存
     * 
     * @param executorIds 要预热的执行器 ID 列表
     */
    async warmupCache(executorIds: string[]): Promise<void> {
        console.log(`[ExecutorConfigResolver] Warming up cache for ${executorIds.length} executors`);
        await this.resolveMany(executorIds);
    }

    /**
     * 清空缓存
     */
    clearCache(): void {
        const size = this.modelResolutionCache.size;
        this.modelResolutionCache.clear();
        console.log(`[ExecutorConfigResolver] Cache cleared (${size} entries)`);
    }

    /**
     * 获取缓存统计
     */
    getCacheStats(): {
        size: number;
        entries: Array<{
            key: string;
            modelId: string;
            age: number;
        }>;
    } {
        const now = Date.now();
        const entries = Array.from(this.modelResolutionCache.entries()).map(
            ([key, value]) => ({
                key,
                modelId: value.modelId,
                age: now - value.timestamp
            })
        );

        return {
            size: this.modelResolutionCache.size,
            entries
        };
    }

    /**
     * 验证执行器配置
     * 
     * @param config 执行器配置
     * @returns 验证结果
     */
    validateConfig(config: ExecutorConfig): {
        valid: boolean;
        errors: string[];
        warnings: string[];
    } {
        const errors: string[] = [];
        const warnings: string[] = [];

        // 必需字段检查
        if (!config.id) {
            errors.push('Missing executor ID');
        }

        if (!config.name) {
            warnings.push('Missing executor name');
        }

        if (!config.type) {
            errors.push('Missing executor type');
        }

        // 连接检查
        if (!config.connection) {
            warnings.push('No connection configured');
        } else {
            if (!config.connection.apiKey) {
                warnings.push('Connection missing API key');
            }

            if (!config.connection.availableModels || config.connection.availableModels.length === 0) {
                warnings.push('Connection has no available models');
            }
        }

        // 模型检查
        if (!config.model) {
            warnings.push('No model specified');
        } else if (config.connection?.availableModels) {
            const modelExists = config.connection.availableModels.some(
                m => m.id === config.model
            );
            if (!modelExists) {
                warnings.push(`Model "${config.model}" not found in connection's available models`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * 获取执行器的可用模型列表
     * 
     * @param executorId 执行器 ID
     * @returns 可用模型列表
     */
    async getAvailableModels(executorId: string): Promise<Array<{
        id: string;
        name: string;
        provider?: string;
    }>> {
        try {
            const agentConfig = await this.agentService.getAgentConfig(executorId);

            if (!agentConfig?.config.connectionId) {
                // 使用默认连接
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
            console.error('[ExecutorConfigResolver] getAvailableModels failed:', e);
            return [];
        }
    }

    /**
     * 检查执行器是否可用
     * 
     * @param executorId 执行器 ID
     * @returns 是否可用
     */
    async isExecutorAvailable(executorId: string): Promise<boolean> {
        try {
            const config = await this.resolve(executorId);
            const validation = this.validateConfig(config);
            return validation.valid && validation.warnings.length === 0;
        } catch {
            return false;
        }
    }
}
