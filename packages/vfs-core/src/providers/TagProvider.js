/**
 * @file vfsCore/providers/TagProvider.js
 * @fileoverview TagProvider - 标签管理 Provider
 */

import { ContentProvider } from './base/ContentProvider.js';
import { VFS_STORES } from '../storage/VFSStorage.js';

export class TagProvider extends ContentProvider {
    constructor(storage, eventBus) {
        super('tag', {
            priority: 2, // 较高优先级
            capabilities: ['tagging', 'global-tags']
        });
        
        this.storage = storage;
        this.events = eventBus;
        this.tagRegex = /#([a-zA-Z0-9_\u4e00-\u9fa5]+)/g;
    }
    
    /**
     * 读取标签信息
     */
    async read(vnode, options = {}) {
        const tags = await this._getNodeTags(vnode.id);
        
        return {
            content: null,
            metadata: {
                tags,
                tagCount: tags.length
            }
        };
    }
    
    /**
     * 写入时提取和更新标签
     */
    async write(vnode, content, transaction) {
        try {
            const store = transaction.getStore(VFS_STORES.TAGS);
            const nodeTagStore = transaction.getStore(VFS_STORES.NODE_TAGS);
            
            // 1. 从内容中提取标签
            const extractedTags = this._extractTags(content);
            
            // 2. 获取节点的元数据标签（手动添加的）
            const metaTags = vnode.meta.tags || [];
            
            // 3. 合并所有标签
            const allTags = [...new Set([...extractedTags, ...metaTags])];
            
            // 4. 确保所有标签在全局标签表中存在
            for (const tagName of allTags) {
                await this._ensureTag(tagName, store);
            }
            
            // 5. 更新节点-标签关联
            await this._updateNodeTags(vnode.id, allTags, nodeTagStore);
            
            // 6. 发布事件
            this.events.emit('tags:updated', {
                nodeId: vnode.id,
                tags: allTags
            });
            
            return {
                updatedContent: content,
                derivedData: {
                    tags: allTags,
                    tagCount: allTags.length
                }
            };
            
        } catch (error) {
            throw new Error(`TagProvider write failed: ${error.message}`);
        }
    }
    
    /**
     * 清理节点标签
     */
    async cleanup(vnode, transaction) {
        const store = transaction.getStore(VFS_STORES.NODE_TAGS);
        const index = store.index('by_nodeId');
        
        return new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.only(vnode.id));
            
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
    
    // ========== 标签管理 API ==========
    
    /**
     * 添加标签到节点
     */
    async addTagToNode(nodeId, tagName) {
        const tx = await this.storage.beginTransaction();
        
        try {
            const tagStore = tx.getStore(VFS_STORES.TAGS);
            const nodeTagStore = tx.getStore(VFS_STORES.NODE_TAGS);
            
            // 确保标签存在
            await this._ensureTag(tagName, tagStore);
            
            // 添加关联
            const relation = {
                id: `${nodeId}-${tagName}`,
                nodeId,
                tagName,
                createdAt: new Date()
            };
            
            await new Promise((resolve, reject) => {
                const request = nodeTagStore.put(relation);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
            
            await tx.commit();
            
            this.events.emit('tags:updated', { nodeId, action: 'add', tagName });
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }
    
    /**
     * 从节点移除标签
     */
    async removeTagFromNode(nodeId, tagName) {
        const tx = await this.storage.beginTransaction();
        
        try {
            const store = tx.getStore(VFS_STORES.NODE_TAGS);
            const id = `${nodeId}-${tagName}`;
            
            await new Promise((resolve, reject) => {
                const request = store.delete(id);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
            
            await tx.commit();
            
            this.events.emit('tags:updated', { nodeId, action: 'remove', tagName });
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }
    
    /**
     * 获取所有全局标签
     */
    async getAllTags() {
        return this.storage.db.getAll(VFS_STORES.TAGS);
    }
    
    /**
     * 创建全局标签
     */
    async createTag(name, options = {}) {
        const tx = await this.storage.beginTransaction();
        
        try {
            const store = tx.getStore(VFS_STORES.TAGS);
            
            const tag = {
                name,
                color: options.color || null,
                description: options.description || '',
                protected: options.protected || false,
                createdAt: new Date()
            };
            
            await new Promise((resolve, reject) => {
                const request = store.put(tag);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
            
            await tx.commit();
            
            this.events.emit('tag:created', { tag });
            
            return tag;
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }
    
    /**
     * 删除全局标签
     */
    async deleteTag(name) {
        const tag = await this.storage.db.getByKey(VFS_STORES.TAGS, name);
        
        if (!tag) {
            throw new Error(`Tag "${name}" not found`);
        }
        
        if (tag.protected) {
            throw new Error(`Cannot delete protected tag "${name}"`);
        }
        
        const tx = await this.storage.beginTransaction();
        
        try {
            // 删除标签
            const tagStore = tx.getStore(VFS_STORES.TAGS);
            await new Promise((resolve, reject) => {
                const request = tagStore.delete(name);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
            
            // 删除所有关联
            const nodeTagStore = tx.getStore(VFS_STORES.NODE_TAGS);
            const index = nodeTagStore.index('by_tagName');
            
            await new Promise((resolve, reject) => {
                const request = index.openCursor(IDBKeyRange.only(name));
                
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
            
            await tx.commit();
            
            this.events.emit('tag:deleted', { name });
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }
    
    /**
     * 根据标签查找节点
     */
    async findNodesByTag(tagName) {
        const relations = await this.storage.db.getAllByIndex(
            VFS_STORES.NODE_TAGS,
            'by_tagName',
            tagName
        );
        
        const nodeIds = relations.map(r => r.nodeId);
        return this.storage.loadVNodes(nodeIds);
    }
    
    /**
     * 重命名标签
     */
    async renameTag(oldName, newName) {
        const tx = await this.storage.beginTransaction();
        
        try {
            const tagStore = tx.getStore(VFS_STORES.TAGS);
            const nodeTagStore = tx.getStore(VFS_STORES.NODE_TAGS);
            
            // 获取旧标签
            const oldTag = await new Promise((resolve, reject) => {
                const request = tagStore.get(oldName);
                request.onsuccess = (e) => resolve(e.target.result);
                request.onerror = (e) => reject(e.target.error);
            });
            
            if (!oldTag) {
                throw new Error(`Tag "${oldName}" not found`);
            }
            
            // 创建新标签
            const newTag = { ...oldTag, name: newName };
            await new Promise((resolve, reject) => {
                const request = tagStore.put(newTag);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
            
            // 更新所有关联
            const index = nodeTagStore.index('by_tagName');
            await new Promise((resolve, reject) => {
                const request = index.openCursor(IDBKeyRange.only(oldName));
                
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        const relation = cursor.value;
                        relation.tagName = newName;
                        relation.id = `${relation.nodeId}-${newName}`;
                        
                        cursor.delete();
                        nodeTagStore.put(relation);
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                
                request.onerror = (e) => reject(e.target.error);
            });
            
            // 删除旧标签
            await new Promise((resolve, reject) => {
                const request = tagStore.delete(oldName);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
            
            await tx.commit();
            
            this.events.emit('tag:renamed', { oldName, newName });
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }
    
    // ========== 私有方法 ==========
    
    _extractTags(content) {
        const tags = [];
        let match;
        
        this.tagRegex.lastIndex = 0;
        while ((match = this.tagRegex.exec(content)) !== null) {
            tags.push(match[1]);
        }
        
        return [...new Set(tags)];
    }
    
    async _getNodeTags(nodeId) {
        const relations = await this.storage.db.getAllByIndex(
            VFS_STORES.NODE_TAGS,
            'by_nodeId',
            nodeId
        );
        
        return relations.map(r => r.tagName);
    }
    
    async _ensureTag(name, store) {
        const existing = await new Promise((resolve) => {
            const request = store.get(name);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = () => resolve(null);
        });
        
        if (!existing) {
            const tag = {
                name,
                color: null,
                description: '',
                protected: false,
                createdAt: new Date()
            };
            
            await new Promise((resolve, reject) => {
                const request = store.put(tag);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        }
    }
    
    async _updateNodeTags(nodeId, tags, store) {
        // 删除旧的关联
        const index = store.index('by_nodeId');
        await new Promise((resolve, reject) => {
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
        
        // 添加新的关联
        for (const tagName of tags) {
            const relation = {
                id: `${nodeId}-${tagName}`,
                nodeId,
                tagName,
                createdAt: new Date()
            };
            
            await new Promise((resolve, reject) => {
                const request = store.put(relation);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        }
    }
}
