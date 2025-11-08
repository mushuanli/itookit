/**
 * @file vfsManager/providers/CompositeProvider.js
 * @fileoverview CompositeProvider - 组合多个 Provider
 * 用于同时应用多个内容提供者到同一节点
 */

import { ContentProvider } from './base/ContentProvider.js';

export class CompositeProvider extends ContentProvider {
    constructor(name, providers = []) {
        super(name, {
            priority: 5,
            capabilities: ['composite']
        });
        
        this.providers = providers;
    }
    
    /**
     * 添加 Provider
     */
    addProvider(provider) {
        if (!(provider instanceof ContentProvider)) {
            throw new Error('Must be a ContentProvider instance');
        }
        this.providers.push(provider);
        
        // 按优先级排序
        this.providers.sort((a, b) => b.priority - a.priority);
    }
    
    /**
     * 移除 Provider
     */
    removeProvider(name) {
        this.providers = this.providers.filter(p => p.name !== name);
    }
    
    /**
     * 组合读取
     */
    async read(vnode, options = {}) {
        let content = options.rawContent;
        const metadata = {};
        
        for (const provider of this.providers) {
            if (provider.canHandle(vnode)) {
                const result = await provider.read(vnode, { ...options, rawContent: content });
                if (result.content !== null) {
                    content = result.content;
                }
                Object.assign(metadata, result.metadata);
            }
        }
        
        return { content, metadata };
    }
    
    /**
     * 组合写入
     */
    async write(vnode, content, transaction) {
        let currentContent = content;
        const allDerivedData = {};
        
        for (const provider of this.providers) {
            if (provider.canHandle(vnode)) {
                const result = await provider.write(vnode, currentContent, transaction);
                currentContent = result.updatedContent;
                Object.assign(allDerivedData, result.derivedData);
            }
        }
        
        return {
            updatedContent: currentContent,
            derivedData: allDerivedData
        };
    }
    
    /**
     * 组合验证
     */
    async validate(vnode, content) {
        const allErrors = [];
        
        for (const provider of this.providers) {
            if (provider.canHandle(vnode)) {
                const result = await provider.validate(vnode, content);
                if (!result.valid) {
                    allErrors.push(...result.errors);
                }
            }
        }
        
        return {
            valid: allErrors.length === 0,
            errors: allErrors
        };
    }
    
    /**
     * 组合清理
     */
    async cleanup(vnode, transaction) {
        for (const provider of this.providers) {
            if (provider.canHandle(vnode)) {
                await provider.cleanup(vnode, transaction);
            }
        }
    }
    
    /**
     * 组合统计
     */
    async getStats(vnode) {
        const stats = {};
        
        for (const provider of this.providers) {
            if (provider.canHandle(vnode)) {
                const providerStats = await provider.getStats(vnode);
                stats[provider.name] = providerStats;
            }
        }
        
        return stats;
    }
}
