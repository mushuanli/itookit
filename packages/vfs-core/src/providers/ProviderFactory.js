/**
 * @file vfsCore/providers/ProviderFactory.js
 * @fileoverview ProviderFactory - Provider 工厂
 */

import { PlainTextProvider } from './PlainTextProvider.js';
import { SRSProvider } from './SRSProvider.js';
import { TaskProvider } from './TaskProvider.js';
import { AgentProvider } from './AgentProvider.js';
import { LinkProvider } from './LinkProvider.js';
import { CompositeProvider } from './CompositeProvider.js';
import { TagProvider } from './TagProvider.js';

export class ProviderFactory {
    /**
     * 创建所有内置 Providers
     * @param {object} deps - 依赖项
     * @param {import('../storage/VFSStorage.js').VFSStorage} deps.storage
     * @param {import('../utils/EventBus.js').EventBus} deps.eventBus
     * @returns {import('./base/ContentProvider.js').ContentProvider[]}
     */
    static createBuiltInProviders({ storage, eventBus }) {
        return [
            new PlainTextProvider(),
            new TagProvider(storage, eventBus), // 新增
            new LinkProvider(storage, eventBus),
            new SRSProvider(storage, eventBus),
            new TaskProvider(storage, eventBus),
            new AgentProvider(storage, eventBus)
        ];
    }
    
    /**
     * 创建 Markdown Provider（组合多个 Provider）
     */
    static createMarkdownProvider({ storage, eventBus }) {
        const composite = new CompositeProvider('markdown', [
            new TagProvider(storage, eventBus), // 新增
            new LinkProvider(storage, eventBus),
            new SRSProvider(storage, eventBus),
            new TaskProvider(storage, eventBus),
            new AgentProvider(storage, eventBus)
        ]);
        
        return composite;
    }
}
