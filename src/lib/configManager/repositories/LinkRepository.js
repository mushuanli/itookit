// #configManager/repositories/LinkRepository.js
import { STORES } from '../constants.js';

export class LinkRepository {
    constructor(db) {
        this.db = db;
    }

    /**
     * 更新一个文件的所有出链 (outgoing links)
     * @param {string} sourceNodeId - 发起引用的文件ID
     * @param {string} content - 文件内容
     * @returns {Promise<void>}
     */
    async updateLinksForNode(sourceNodeId, content) {
        // 【修复】增加ID校验，防止向数据库传递 undefined 的 key
        if (!sourceNodeId) {
            console.warn("updateLinksForNode 被调用，但 sourceNodeId 无效，操作已跳过。");
            return;
        }

        // 这是一个简化的解析逻辑，实际应用中需要更健壮的正则表达式
        const linkRegex = /\[\[([a-zA-Z0-9_-]+-[0-9a-fA-F-]+)\]\]/g;
        let match;
        const targetNodeIds = new Set();
        while ((match = linkRegex.exec(content)) !== null) {
            targetNodeIds.add(match[1]);
        }
        
        const tx = await this.db.getTransaction(STORES.LINKS, 'readwrite');
        const store = tx.objectStore(STORES.LINKS);
        const index = store.index('by_source');

        // 1. 删除旧的链接
        await new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.only(sourceNodeId)); // [FIX] 给请求命名
            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = reject; // [FIX] 添加错误处理
        });

        // 2. 添加新的链接
        for (const targetNodeId of targetNodeIds) {
            // 使用 try-catch 优雅处理可能的 ConstraintError (如果链接已存在)
            try {
                await store.put({ sourceNodeId, targetNodeId });
            } catch (error) {
                if (error.name !== 'ConstraintError') {
                    throw error;
                }
            }
        }
    }

    /**
     * 获取一个文件的所有反向链接 (backlinks)
     * @param {string} targetNodeId - 被引用的文件ID
     * @returns {Promise<object[]>} 引用该文件的节点对象数组
     */
    async getBacklinks(targetNodeId) {
        const links = await this.db.getAllByIndex(STORES.LINKS, 'by_target', targetNodeId);
        const sourceNodeIds = links.map(link => link.sourceNodeId);

        if (sourceNodeIds.length === 0) return [];
        
        const tx = await this.db.getTransaction(STORES.NODES, 'readonly');
        const store = tx.objectStore(STORES.NODES);
        
        const nodes = await Promise.all(
            sourceNodeIds.map(id => new Promise((resolve, reject) => { // [FIX] 添加 reject
                const request = store.get(id);
                request.onsuccess = e => resolve(e.target.result);
                request.onerror = reject;
            }))
        );

        return nodes.filter(Boolean);
    }
}
