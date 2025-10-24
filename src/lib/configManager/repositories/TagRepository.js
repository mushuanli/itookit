// #configManager/repositories/TagRepository.js

import { STORES, EVENTS } from '../constants.js';

export class TagRepository {
    /**
     * @param {import('../db.js').Database} db
     * @param {import('../EventManager.js').EventManager} eventManager
     */
    constructor(db, eventManager) { // [FIX] 注入 EventManager
        this.db = db;
        this.events = eventManager;
    }

    /**
     * [新增] 获取所有已定义的全局标签。
     * @returns {Promise<object[]>} 返回一个标签对象数组, e.g., [{ name: 'tag1', createdAt: ... }]
     */
    async getAllTags() {
        const tx = await this.db.getTransaction(STORES.TAGS, 'readonly');
        const store = tx.objectStore(STORES.TAGS);
        const allTags = await new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });

        // 按名称排序，为UI提供一致的顺序
        return allTags.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * 【新增】根据节点ID获取其所有标签名称。
     * 这是UI层在适配Node数据时获取标签信息的关键方法。
     * @param {string} nodeId - 节点的ID。
     * @returns {Promise<string[]>} 一个包含该节点所有标签名称的字符串数组。
     */
    async getTagsForNode(nodeId) {
        if (!nodeId) {
            return [];
        }
        // 使用 getAllByIndex 辅助函数高效查询 nodeTags 表中与 nodeId 关联的所有记录
        const relations = await this.db.getAllByIndex(STORES.NODE_TAGS, 'by_nodeId', nodeId);
        // 从查询到的关联对象中提取 tagName 字段，并返回一个字符串数组
        return relations.map(rel => rel.tagName);
    }

    /**
     * 为节点添加标签
     * @param {string} nodeId
     * @param {string} tagName
     * @returns {Promise<void>}
     */
    async addTagToNode(nodeId, tagName) {
        const tx = await this.db.getTransaction([STORES.TAGS, STORES.NODE_TAGS], 'readwrite');
        const tagsStore = tx.objectStore(STORES.TAGS);
        const nodeTagsStore = tx.objectStore(STORES.NODE_TAGS);

        // 1. 确保标签存在于 tags 表中（不存在则创建）
        await tagsStore.put({ name: tagName, createdAt: new Date() });

        try {
            // 【修改】添加错误处理，优雅地处理重复添加的情况
            await nodeTagsStore.put({ nodeId, tagName });
        } catch (error) {
            if (error.name === 'ConstraintError') {
                console.warn(`Tag '${tagName}' already exists on node '${nodeId}'. Operation ignored.`);
                // 约束错误意味着关系已存在，可安全忽略
            } else {
                throw error; // 抛出其他未知错误
            }
        }
        
        // [FIX] 在事务成功提交后发布事件
        tx.oncomplete = () => {
            this.events.publish(EVENTS.TAGS_UPDATED, { action: 'add', nodeId, tagName });
        };
    }
    
    /**
     * 【新增】从节点移除一个标签
     * @param {string} nodeId
     * @param {string} tagName
     * @returns {Promise<void>}
     */
    async removeTagFromNode(nodeId, tagName) {
        const tx = await this.db.getTransaction(STORES.NODE_TAGS, 'readwrite');
        const store = tx.objectStore(STORES.NODE_TAGS);
        const index = store.index('by_node_tag');
        
        // 使用复合索引精确查找要删除的记录
        const key = [nodeId, tagName];
        const request = index.getKey(key);
        
        await new Promise((resolve, reject) => {
            request.onsuccess = () => {
                if (request.result) {
                    store.delete(request.result).onsuccess = resolve;
                } else {
                    resolve(); // 记录不存在，直接成功
                }
            };
            request.onerror = reject;
        });

        // [FIX] 在事务成功提交后发布事件
        tx.oncomplete = () => {
            this.events.publish(EVENTS.TAGS_UPDATED, { action: 'remove', nodeId, tagName });
        };
    }

    /**
     * [FIX] 新增方法：设置一个节点的完整标签列表 (原子操作)。
     * @param {string} nodeId
     * @param {string[]} tagNames - 该节点应有的最终标签列表。
     * @returns {Promise<void>}
     */
    async setTagsForNode(nodeId, tagNames) {
        const tx = await this.db.getTransaction([STORES.TAGS, STORES.NODE_TAGS], 'readwrite');
        const tagsStore = tx.objectStore(STORES.TAGS);
        const nodeTagsStore = tx.objectStore(STORES.NODE_TAGS);
        const nodeTagsIndex = nodeTagsStore.index('by_nodeId');

        // 1. 删除该节点所有旧的标签关联
        await new Promise((resolve, reject) => {
            const cursorRequest = nodeTagsIndex.openCursor(IDBKeyRange.only(nodeId));
            cursorRequest.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            cursorRequest.onerror = reject;
        });

        // 2. 确保所有新标签都存在，并为节点添加关联
        for (const tagName of tagNames) {
            if (typeof tagName === 'string' && tagName.trim()) {
                await tagsStore.put({ name: tagName.trim(), createdAt: new Date() });
                await nodeTagsStore.put({ nodeId, tagName: tagName.trim() });
            }
        }
        
        // [FIX] 在事务成功提交后发布事件
        tx.oncomplete = () => {
            this.events.publish(EVENTS.TAGS_UPDATED, { action: 'set', nodeId, tags: tagNames });
        };
    }

    /**
     * [FIX] 新增方法：确保一组标签存在于全局标签表中。
     * @param {string[]} tagNames
     * @returns {Promise<void>}
     */
    async ensureTagsExist(tagNames) {
        if (!tagNames || tagNames.length === 0) return;
        const tx = await this.db.getTransaction(STORES.TAGS, 'readwrite');
        const store = tx.objectStore(STORES.TAGS);
        for (const tagName of tagNames) {
            if (typeof tagName === 'string' && tagName.trim()) {
                await store.put({ name: tagName.trim(), createdAt: new Date() });
            }
        }
    }


    /**
     * 全局重命名一个标签。
     * @param {string} oldTagName
     * @param {string} newTagName
     * @returns {Promise<void>}
     */
    async renameTagGlobally(oldTagName, newTagName) {
        // 事务需要包含所有受影响的表
        const tx = await this.db.getTransaction([STORES.TAGS, STORES.NODE_TAGS], 'readwrite');
        const tagsStore = tx.objectStore(STORES.TAGS);
        const nodeTagsStore = tx.objectStore(STORES.NODE_TAGS);
        const nodeTagsIndex = nodeTagsStore.index('by_tagName');

        // 1. 在 tags 表中创建新标签，并删除旧标签
        await tagsStore.put({ name: newTagName, createdAt: new Date() });
        await tagsStore.delete(oldTagName);

        await new Promise((resolve, reject) => {
            nodeTagsIndex.openCursor(IDBKeyRange.only(oldTagName)).onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const record = cursor.value;
                    record.tagName = newTagName;
                    cursor.update(record);
                    cursor.continue();
                } else {
                    resolve(); // 游标结束
                }
            };
            tx.onerror = reject; // 监听整个事务的错误
        });

        // [FIX] 在事务成功提交后发布事件
        tx.oncomplete = () => {
            this.events.publish(EVENTS.TAGS_UPDATED, { action: 'rename_global', oldTagName, newTagName });
        };
    }

    /**
     * 【新增】全局删除一个标签及其所有关联
     * @param {string} tagName
     * @returns {Promise<void>}
     */
    async deleteTagGlobally(tagName) {
        const tx = await this.db.getTransaction([STORES.TAGS, STORES.NODE_TAGS], 'readwrite');
        const tagsStore = tx.objectStore(STORES.TAGS);
        const nodeTagsStore = tx.objectStore(STORES.NODE_TAGS);
        const nodeTagsIndex = nodeTagsStore.index('by_tagName');
        
        // 1. 从 tags 表删除标签定义
        await tagsStore.delete(tagName);

        await new Promise((resolve, reject) => {
            nodeTagsIndex.openCursor(IDBKeyRange.only(tagName)).onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            tx.onerror = reject;
        });

        // [FIX] 在事务成功提交后发布事件
        tx.oncomplete = () => {
            this.events.publish(EVENTS.TAGS_UPDATED, { action: 'delete_global', tagName });
        };
    }

    /**
     * 根据标签名查找所有关联的节点。
     * @param {string} tagName
     * @returns {Promise<object[]>}
     */
    async findNodesByTag(tagName) {
        // 1. 从 nodeTags 表找到所有关联的 nodeId
        const nodeTagRelations = await this.db.getAllByIndex(STORES.NODE_TAGS, 'by_tagName', tagName);
        const nodeIds = nodeTagRelations.map(rel => rel.nodeId);

        if (nodeIds.length === 0) return [];

        // 2. 根据 nodeId 批量获取节点信息
        const tx = await this.db.getTransaction(STORES.NODES, 'readonly');
        const store = tx.objectStore(STORES.NODES);
        
        const nodes = await Promise.all(
            nodeIds.map(id => new Promise(resolve => store.get(id).onsuccess = e => resolve(e.target.result)))
        );

        return nodes.filter(Boolean); // 过滤掉可能已删除的节点
    }
}
