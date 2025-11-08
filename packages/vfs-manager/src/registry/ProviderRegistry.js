/**
 * @file vfsManager/registry/ProviderRegistry.js
 * @fileoverview ProviderRegistry - Provider 注册表
 */

import { ProviderError } from '../core/VFSError.js';

export class ProviderRegistry {
    constructor() {
        /** @type {Map<string, import('../providers/base/ContentProvider.js').ContentProvider>} */
        this.providers = new Map();
        
        /** @type {Map<string, string[]>} */
        this.typeMappings = new Map();
        
        /** @type {Map<string, Function[]>} */
        this.hooks = new Map();
    }
    
    /**
     * 注册 provider
     * @param {import('../providers/base/ContentProvider.js').ContentProvider} provider
     */
    register(provider) {
        if (!provider || typeof provider.name !== 'string') {
            throw new ProviderError('unknown', 'Invalid provider: must have a name');
        }
        
        if (this.providers.has(provider.name)) {
            console.warn(`[ProviderRegistry] Provider '${provider.name}' already registered, overwriting`);
        }
        
        this.providers.set(provider.name, provider);
        console.log(`[ProviderRegistry] Registered provider: ${provider.name}`);
        
        // 触发注册钩子
        this._triggerHook('provider:registered', provider);
    }
    
    /**
     * 注销 provider
     * @param {string} name
     */
    unregister(name) {
        const provider = this.providers.get(name);
        if (provider) {
            this.providers.delete(name);
            this._triggerHook('provider:unregistered', provider);
            console.log(`[ProviderRegistry] Unregistered provider: ${name}`);
        }
    }
    
    /**
     * 获取 provider
     * @param {string} name
     * @returns {import('../providers/base/ContentProvider.js').ContentProvider|undefined}
     */
    get(name) {
        return this.providers.get(name);
    }
    
    /**
     * 检查 provider 是否存在
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
        return this.providers.has(name);
    }
    
    /**
     * 为节点获取所有适用的 providers
     * @param {import('../core/VNode.js').VNode} vnode
     * @returns {import('../providers/base/ContentProvider.js').ContentProvider[]}
     */
    getProvidersForNode(vnode) {
        const providers = [];
        
        for (const providerName of vnode.providers) {
            const provider = this.get(providerName);
            if (provider && provider.enabled && provider.canHandle(vnode)) {
                providers.push(provider);
            }
        }
        
        // 按优先级排序（优先级高的先执行）
        return providers.sort((a, b) => b.priority - a.priority);
    }
    
    /**
     * 注册类型映射
     * @param {string} contentType - 内容类型
     * @param {string[]} providerNames - Provider 名称列表
     */
    mapType(contentType, providerNames) {
        this.typeMappings.set(contentType, providerNames);
        console.log(`[ProviderRegistry] Mapped type '${contentType}' to providers: ${providerNames.join(', ')}`);
    }
    
    /**
     * 根据类型获取默认 providers
     * @param {string} contentType
     * @returns {string[]}
     */
    getDefaultProviders(contentType) {
        return this.typeMappings.get(contentType) || ['plain'];
    }
    
    /**
     * 获取所有已注册的 provider 名称
     * @returns {string[]}
     */
    getProviderNames() {
        return Array.from(this.providers.keys());
    }
    
    /**
     * 获取所有 providers
     * @returns {import('../providers/base/ContentProvider.js').ContentProvider[]}
     */
    getAllProviders() {
        return Array.from(this.providers.values());
    }
    
    /**
     * 注册生命周期钩子
     * @param {string} event - 事件名称
     * @param {Function} callback - 回调函数
     * @returns {Function} 取消订阅函数
     */
    onHook(event, callback) {
        if (!this.hooks.has(event)) {
            this.hooks.set(event, []);
        }
        this.hooks.get(event).push(callback);
        
        // 返回取消订阅函数
        return () => {
            const callbacks = this.hooks.get(event);
            if (callbacks) {
                const index = callbacks.indexOf(callback);
                if (index > -1) {
                    callbacks.splice(index, 1);
                }
            }
        };
    }
    
    /**
     * 触发钩子
     * @private
     */
    _triggerHook(event, data) {
        const callbacks = this.hooks.get(event) || [];
        callbacks.forEach(cb => {
            try {
                cb(data);
            } catch (error) {
                console.error(`[ProviderRegistry] Hook error for ${event}:`, error);
            }
        });
    }
}
