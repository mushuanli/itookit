// @file: llm-kernel/plugins/plugin-manager.ts

import { IKernelPlugin, PluginContext, PluginMetadata } from './plugin-interface';
import { getExecutorRegistry, ExecutorRegistry } from '../executors';
import { getEventBus, EventBus } from '../core/event-bus';

/**
 * 插件管理器
 */
export class PluginManager {
    private plugins = new Map<string, IKernelPlugin>();
    private registry: ExecutorRegistry;
    private eventBus: EventBus;
    private config: Record<string, any> = {};
    
    constructor() {
        this.registry = getExecutorRegistry();
        this.eventBus = getEventBus();
    }
    
    /**
     * 设置配置
     */
    setConfig(config: Record<string, any>): void {
        this.config = { ...this.config, ...config };
    }
    
    /**
     * 注册插件
     */
    async register(plugin: IKernelPlugin): Promise<void> {
        const { id } = plugin.metadata;
        
        if (this.plugins.has(id)) {
            throw new Error(`Plugin ${id} is already registered`);
        }
        
        // 检查依赖
        await this.checkDependencies(plugin.metadata);
        
        // 创建插件上下文
        const context = this.createPluginContext(plugin.metadata);
        
        // 初始化插件
        await plugin.initialize(context);
        
        this.plugins.set(id, plugin);
        
        console.log(`[PluginManager] Registered plugin: ${id} v${plugin.metadata.version}`);
    }
    
    /**
     * 卸载插件
     */
    async unregister(pluginId: string): Promise<void> {
        const plugin = this.plugins.get(pluginId);
        if (!plugin) return;
        
        if (plugin.destroy) {
            await plugin.destroy();
        }
        
        this.plugins.delete(pluginId);
        console.log(`[PluginManager] Unregistered plugin: ${pluginId}`);
    }
    
    /**
     * 获取已注册的插件列表
     */
    getPlugins(): PluginMetadata[] {
        return Array.from(this.plugins.values()).map(p => p.metadata);
    }
    
    private async checkDependencies(metadata: PluginMetadata): Promise<void> {
        if (!metadata.dependencies) return;
        
        for (const dep of metadata.dependencies) {
            if (!this.plugins.has(dep)) {
                throw new Error(`Plugin ${metadata.id} requires ${dep} which is not loaded`);
            }
        }
    }
    
    private createPluginContext(metadata: PluginMetadata): PluginContext {
        const prefix = `[Plugin:${metadata.id}]`;
        
        return {
            registerExecutor: (type, creator) => {
                this.registry.registerExecutor(type as any, creator);
            },
            
            registerOrchestrator: (mode, creator) => {
                this.registry.registerOrchestrator(mode as any, creator);
            },
            
            onEvent: (type, handler) => {
                return this.eventBus.on(type, handler);
            },
            
            getConfig: <T>(key: string) => {
                return this.config[key] as T;
            },
            
            log: {
                debug: (msg, ...args) => console.debug(prefix, msg, ...args),
                info: (msg, ...args) => console.info(prefix, msg, ...args),
                warn: (msg, ...args) => console.warn(prefix, msg, ...args),
                error: (msg, ...args) => console.error(prefix, msg, ...args)
            }
        };
    }
}

// 单例
let pluginManager: PluginManager | null = null;

export function getPluginManager(): PluginManager {
    if (!pluginManager) {
        pluginManager = new PluginManager();
    }
    return pluginManager;
}
