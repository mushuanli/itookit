/**
 * @file vfsCore/providers/LinkProvider.js
 * @fileoverview LinkProvider - 链接关系内容提供者
 * 处理 [[node-id]] 和 ![[node-id]] 格式的链接
 */

import { ContentProvider } from './base/ContentProvider.js';
import { VFS_STORES } from '../storage/VFSStorage.js';
import { ProviderError } from '../core/VFSError.js';

export class LinkProvider extends ContentProvider {
    constructor(storage, eventBus) {
        super('link', {
            priority: 6,
            capabilities: ['bidirectional-links', 'embeds']
        });
        
        this.storage = storage;
        this.events = eventBus;
        
        // 链接正则：[[node-id]] 或 [[node-id|显示文本]] 或 ![[node-id]]
        this.linkRegex = /(!?)$$\[([^$$|]+)(?:\|([^\]]+))?\]\]/g;
    }
    
    /**
     * 读取链接内容
     */
    async read(vnode, options = {}) {
        const links = await this._getLinks(vnode.id);
        const backlinks = await this._getBacklinks(vnode.id);
        
        return {
            content: null,
            metadata: {
                outgoingLinks: links.map(l => ({
                    targetId: l.targetId,
                    type: l.type,
                    displayText: l.displayText
                })),
                incomingLinks: backlinks.map(l => ({
                    sourceId: l.sourceId,
                    type: l.type
                })),
                linkCount: links.length,
                backlinkCount: backlinks.length
            }
        };
    }
    
    /**
     * 写入链接内容，解析并协调链接关系
     */
    async write(vnode, content, transaction) {
        try {
            const store = transaction.getStore(VFS_STORES.LINKS);
            
            // 1. 解析链接
            const links = this._parseLinks(vnode.id, content);
            
            // 2. 删除旧链接
            await this._deleteNodeLinks(vnode.id, store);
            
            // 3. 保存新链接
            for (const link of links) {
                await this._saveLink(link, store);
            }
            
            // 4. 发布事件
            if (links.length > 0) {
                this.events.emit('links:updated', {
                    nodeId: vnode.id,
                    linkCount: links.length
                });
            }
            
            return {
                updatedContent: content, // 链接不修改内容
                derivedData: {
                    links: links.map(l => ({
                        targetId: l.targetId,
                        type: l.type
                    })),
                    stats: {
                        total: links.length,
                        embeds: links.filter(l => l.type === 'embed').length,
                        references: links.filter(l => l.type === 'reference').length
                    }
                }
            };
            
        } catch (error) {
            throw new ProviderError('link', `Failed to process links: ${error.message}`);
        }
    }
    
    /**
     * 验证链接内容
     */
    async validate(vnode, content) {
        const errors = [];
        
        // 检查链接格式
        this.linkRegex.lastIndex = 0;
        let match;
        
        while ((match = this.linkRegex.exec(content)) !== null) {
            const [, isEmbed, targetId] = match;
            
            // 验证 ID 格式
            if (!targetId || !/^[a-zA-Z0-9_-]+$/.test(targetId)) {
                errors.push(`Invalid link target ID: ${targetId}`);
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    /**
     * 清理节点的所有链接
     */
    async cleanup(vnode, transaction) {
        const store = transaction.getStore(VFS_STORES.LINKS);
        
        // 删除出链
        await this._deleteNodeLinks(vnode.id, store);
        
        // 删除入链（其他节点指向此节点的链接）
        const index = store.index('by_targetId');
        
        return new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.only(vnode.id));
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    this.events.emit('links:deleted', { nodeId: vnode.id });
                    resolve();
                }
            };
            
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    /**
     * 获取链接统计信息
     */
    async getStats(vnode) {
        const links = await this._getLinks(vnode.id);
        const backlinks = await this._getBacklinks(vnode.id);
        
        return {
            outgoing: links.length,
            incoming: backlinks.length,
            embeds: links.filter(l => l.type === 'embed').length,
            references: links.filter(l => l.type === 'reference').length
        };
    }
    
    /**
     * 处理节点移动
     */
    async onMove(vnode, oldPath, newPath, transaction) {
        // 链接使用 ID，移动不影响链接关系
        // 但可能需要更新显示文本中的路径引用
    }
    
    // ========== 私有方法 ==========
    
    /**
     * 解析内容中的链接
     */
    _parseLinks(sourceId, content) {
        const links = [];
        this.linkRegex.lastIndex = 0;
        let match;
        
        while ((match = this.linkRegex.exec(content)) !== null) {
            const [, isEmbed, targetId, displayText] = match;
            
            const link = {
                id: `link-${this._generateShortId()}`,
                sourceId,
                targetId,
                type: isEmbed ? 'embed' : 'reference',
                displayText: displayText || null,
                createdAt: new Date()
            };
            
            links.push(link);
        }
        
        return links;
    }
    
    /**
     * 获取节点的出链
     */
    async _getLinks(nodeId, transaction = null) {
        if (transaction) {
            const store = transaction.getStore(VFS_STORES.LINKS);
            const index = store.index('by_source');
            
            return new Promise((resolve, reject) => {
                const request = index.getAll(nodeId);
                request.onsuccess = (e) => resolve(e.target.result || []);
                request.onerror = (e) => reject(e.target.error);
            });
        }
        
        return this.storage.db.getAllByIndex(
            VFS_STORES.LINKS,
            'by_sourceId',
            nodeId
        );
    }
    
    /**
     * 获取节点的入链（反向链接）
     */
    async _getBacklinks(nodeId) {
        return this.storage.db.getAllByIndex(
            VFS_STORES.LINKS,
            'by_target',
            nodeId
        );
    }
    
    /**
     * 保存链接
     */
    async _saveLink(link, store) {
        return new Promise((resolve, reject) => {
            const request = store.put(link);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    /**
     * 删除节点的所有出链
     */
    async _deleteNodeLinks(nodeId, store) {
        const index = store.index('by_sourceId');
        
        return new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.only(nodeId));
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    /**
     * 生成短 ID
     */
    _generateShortId() {
        return Math.random().toString(36).substring(2, 9);
    }
}
