/**
 * @file vfsManager/providers/SRSProvider.js
 * @fileoverview SRSProvider - 间隔重复学习内容提供者
 * 处理 {{c1::cloze deletion}} 格式的挖空卡片
 */

import { ContentProvider } from './base/ContentProvider.js';
import { VFS_STORES } from '../storage/VFSStorage.js';
import { ProviderError } from '../core/VFSError.js';

export class SRSProvider extends ContentProvider {
    constructor(storage, eventBus) {
        super('srs', {
            priority: 10,
            capabilities: ['cloze', 'spaced-repetition']
        });
        
        this.storage = storage;
        this.events = eventBus;
        this.clozeRegex = /\{\{c\d+::(.*?)\}\}(?:\s*\^([a-z0-9-]+))?/g;
    }
    
    /**
     * 读取 SRS 内容，附加卡片元数据
     */
    async read(vnode, options = {}) {
        const clozes = await this._getClozes(vnode.id);
        
        return {
            content: null, // 不修改原始内容
            metadata: {
                clozes: clozes.map(c => ({
                    id: c.id,
                    content: c.content,
                    status: c.status,
                    dueAt: c.dueAt,
                    interval: c.interval,
                    easeFactor: c.easeFactor,
                    reviewCount: c.reviewCount
                })),
                totalCards: clozes.length,
                dueCards: clozes.filter(c => new Date(c.dueAt) <= new Date()).length,
                newCards: clozes.filter(c => c.status === 'new').length
            }
        };
    }
    
    /**
     * 写入 SRS 内容，解析并协调挖空卡片
     */
    async write(vnode, content, transaction) {
        try {
            const store = transaction.getStore(VFS_STORES.SRS_CLOZES);
            
            // 1. 解析内容中的挖空
            const { updatedContent, clozes } = await this._parseClozes(
                vnode.id,
                content,
                store
            );
            
            // 2. 获取现有卡片
            const existingClozes = await this._getClozes(vnode.id, transaction);
            const existingIds = new Set(existingClozes.map(c => c.id));
            const foundIds = new Set(clozes.map(c => c.id));
            
            // 3. 删除已移除的卡片
            const removedIds = [...existingIds].filter(id => !foundIds.has(id));
            for (const id of removedIds) {
                await this._deleteCard(id, store);
            }
            
            // 4. 保存/更新卡片
            for (const cloze of clozes) {
                await this._saveCard(cloze, store);
            }
            
            // 5. 发布事件
            if (clozes.length > 0 || removedIds.length > 0) {
                this.events.emit('srs:cards-updated', {
                    nodeId: vnode.id,
                    added: clozes.filter(c => !existingIds.has(c.id)).length,
                    updated: clozes.filter(c => existingIds.has(c.id)).length,
                    removed: removedIds.length
                });
            }
            
            return {
                updatedContent,
                derivedData: {
                    clozes: clozes.map(c => ({
                        id: c.id,
                        content: c.content,
                        status: c.status
                    })),
                    stats: {
                        total: clozes.length,
                        new: clozes.filter(c => c.status === 'new').length,
                        learning: clozes.filter(c => c.status === 'learning').length,
                        review: clozes.filter(c => c.status === 'review').length
                    }
                }
            };
            
        } catch (error) {
            throw new ProviderError('srs', `Failed to process SRS content: ${error.message}`);
        }
    }
    
    /**
     * 验证 SRS 内容
     */
    async validate(vnode, content) {
        const errors = [];
        
        // 检查挖空格式
        const matches = [...content.matchAll(this.clozeRegex)];
        
        for (const match of matches) {
            const [fullMatch, clozeText, clozeId] = match;
            
            // 验证挖空文本不为空
            if (!clozeText || clozeText.trim() === '') {
                errors.push(`Empty cloze deletion at position ${match.index}`);
            }
            
            // 验证 ID 格式（如果存在）
            if (clozeId && !/^clz-[a-z0-9-]+$/.test(clozeId)) {
                errors.push(`Invalid cloze ID format: ${clozeId}`);
            }
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    /**
     * 清理节点的所有 SRS 卡片
     */
    async cleanup(vnode, transaction) {
        const store = transaction.getStore(VFS_STORES.SRS_CLOZES);
        const index = store.index('by_nodeId');
        
        return new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.only(vnode.id));
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    this.events.emit('srs:cards-deleted', { nodeId: vnode.id });
                    resolve();
                }
            };
            
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    /**
     * 获取 SRS 统计信息
     */
    async getStats(vnode) {
        const clozes = await this._getClozes(vnode.id);
        const now = new Date();
        
        return {
            total: clozes.length,
            new: clozes.filter(c => c.status === 'new').length,
            learning: clozes.filter(c => c.status === 'learning').length,
            review: clozes.filter(c => c.status === 'review').length,
            due: clozes.filter(c => new Date(c.dueAt) <= now).length,
            suspended: clozes.filter(c => c.status === 'suspended').length
        };
    }
    
    /**
     * 处理节点复制
     */
    async onCopy(sourceVNode, targetVNode, transaction) {
        const sourceClozes = await this._getClozes(sourceVNode.id, transaction);
        const store = transaction.getStore(VFS_STORES.SRS_CLOZES);
        
        // 复制卡片到新节点（重置学习进度）
        for (const cloze of sourceClozes) {
            const newCard = {
                ...cloze,
                id: `clz-${this._generateShortId()}`,
                nodeId: targetVNode.id,
                status: 'new',
                dueAt: new Date(),
                interval: 0,
                reviewCount: 0,
                lastReviewed: null
            };
            
            await this._saveCard(newCard, store);
        }
    }

    /**
     * 评分单张卡片
     * @param {string} clozeId
     * @param {'again'|'hard'|'good'|'easy'} rating
     */
    async gradeCard(clozeId, rating) {
        const card = await this.storage.db.getByKey(VFS_STORES.SRS_CLOZES, clozeId);
        
        if (!card) {
            throw new Error(`Card ${clozeId} not found`);
        }
        
        const tx = await this.storage.beginTransaction();
        
        try {
            const store = tx.getStore(VFS_STORES.SRS_CLOZES);
            
            // SM-2 算法
            const updatedCard = this._applyGrading(card, rating);
            
            await this._saveCard(updatedCard, store);
            await tx.commit();
            
            this.events.emit('srs:card-graded', {
                cardId: clozeId,
                rating,
                newState: updatedCard
            });
            
            return updatedCard;
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }
    
    /**
     * 重置卡片
     */
    async resetCard(clozeId) {
        const card = await this.storage.db.getByKey(VFS_STORES.SRS_CLOZES, clozeId);
        
        if (!card) return;
        
        const tx = await this.storage.beginTransaction();
        
        try {
            const store = tx.getStore(VFS_STORES.SRS_CLOZES);
            
            card.status = 'new';
            card.interval = 0;
            card.easeFactor = 2.5;
            card.reviewCount = 0;
            card.dueAt = new Date();
            card.lastReviewed = null;
            
            await this._saveCard(card, store);
            await tx.commit();
            
            this.events.emit('srs:card-reset', { cardId: clozeId });
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }

    // ========== 私有方法 ==========
    
    /**
     * 解析内容中的挖空
     */
    async _parseClozes(nodeId, content, store) {
        let updatedContent = '';
        let lastIndex = 0;
        const clozes = [];
        
        let match;
        this.clozeRegex.lastIndex = 0; // 重置正则
        
        while ((match = this.clozeRegex.exec(content)) !== null) {
            const [fullMatch, clozeText, existingId] = match;
            
            // 生成或复用 ID
            let clozeId = existingId || `clz-${this._generateShortId()}`;
            
            // 添加到结果
            updatedContent += content.substring(lastIndex, match.index);
            
            // 构建新的挖空块（确保有 ID）
            let newBlock = `{{c1::${clozeText}}}`;
            if (!existingId) {
                newBlock += ` ^${clozeId}`;
            } else {
                newBlock = fullMatch;
            }
            
            updatedContent += newBlock;
            lastIndex = this.clozeRegex.lastIndex;
            
            // 获取或创建卡片
            const existingCard = await this._getCardById(clozeId, store);
            
            const card = {
                id: clozeId,
                nodeId,
                content: clozeText,
                status: existingCard?.status || 'new',
                dueAt: existingCard?.dueAt || new Date(),
                interval: existingCard?.interval || 0,
                easeFactor: existingCard?.easeFactor || 2.5,
                reviewCount: existingCard?.reviewCount || 0,
                lastReviewed: existingCard?.lastReviewed || null,
                createdAt: existingCard?.createdAt || new Date(),
                updatedAt: new Date()
            };
            
            clozes.push(card);
        }
        
        updatedContent += content.substring(lastIndex);
        
        return { updatedContent, clozes };
    }
    
    /**
     * 获取节点的所有卡片
     */
    async _getClozes(nodeId, transaction = null) {
        if (transaction) {
            const store = transaction.getStore(VFS_STORES.SRS_CLOZES);
            const index = store.index('by_nodeId');
            
            return new Promise((resolve, reject) => {
                const request = index.getAll(nodeId);
                request.onsuccess = (e) => resolve(e.target.result || []);
                request.onerror = (e) => reject(e.target.error);
            });
        }
        
        return this.storage.db.getAllByIndex(
            VFS_STORES.SRS_CLOZES,
            'by_nodeId',
            nodeId
        );
    }
    
    /**
     * 根据 ID 获取卡片
     */
    async _getCardById(clozeId, store) {
        return new Promise((resolve) => {
            const request = store.get(clozeId);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = () => resolve(null);
        });
    }
    
    /**
     * 保存卡片
     */
    async _saveCard(card, store) {
        return new Promise((resolve, reject) => {
            const request = store.put(card);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    /**
     * 删除卡片
     */
    async _deleteCard(clozeId, store) {
        return new Promise((resolve, reject) => {
            const request = store.delete(clozeId);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    /**
     * 生成短 ID
     */
    _generateShortId() {
        return Math.random().toString(36).substring(2, 9);
    }

    /**
     * SM-2 评分算法
     */
    _applyGrading(card, rating) {
        const now = new Date();
        card.lastReviewed = now;
        card.reviewCount++;
        
        // 调整难度系数
        switch (rating) {
            case 'again':
                card.easeFactor = Math.max(1.3, card.easeFactor - 0.2);
                card.interval = 0;
                card.status = 'learning';
                break;
            case 'hard':
                card.easeFactor = Math.max(1.3, card.easeFactor - 0.15);
                card.interval = Math.max(1, Math.ceil(card.interval * 1.2));
                card.status = 'learning';
                break;
            case 'good':
                if (card.interval === 0) {
                    card.interval = 1;
                } else if (card.interval < 3) {
                    card.interval = 6;
                } else {
                    card.interval = Math.ceil(card.interval * card.easeFactor);
                }
                card.status = 'review';
                break;
            case 'easy':
                card.easeFactor = card.easeFactor + 0.15;
                card.interval = Math.ceil((card.interval || 1) * card.easeFactor * 1.3);
                card.status = 'review';
                break;
        }
        
        // 计算下次复习时间
        const dueDate = new Date(now);
        dueDate.setDate(dueDate.getDate() + card.interval);
        dueDate.setHours(0, 0, 0, 0);
        card.dueAt = dueDate;
        
        return card;
    }
}
