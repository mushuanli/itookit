// #configManager/repositories/SearchRepository.js

/**
 * @fileoverview 提供跨表的复杂搜索功能。
 */
import { STORES } from '../constants.js';

export class SearchRepository {
    /**
     * @param {import('../db.js').Database} db - 数据库实例
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * 全局文本搜索。
     * 在所有节点的名称和内容中搜索关键词。
     * 注意：此实现通过遍历所有节点来完成，对于大型数据库可能会有性能问题。
     * 在生产环境中，可以考虑引入像 Lunr.js 或 FlexSearch.js 这样的全文搜索库。
     * @param {string} searchText - 要搜索的文本
     * @returns {Promise<object[]>} 匹配的节点对象数组
     */
    async globalTextSearch(searchText) {
        if (!searchText || searchText.trim() === '') {
            return [];
        }

        const lowerCaseQuery = searchText.toLowerCase();
        const results = [];
        
        const tx = await this.db.getTransaction(STORES.NODES, 'readonly');
        const store = tx.objectStore(STORES.NODES);

        return new Promise((resolve, reject) => {
            const request = store.openCursor();

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const node = cursor.value;
                    let isMatch = false;

                    // 搜索节点名称
                    if (node.name && node.name.toLowerCase().includes(lowerCaseQuery)) {
                        isMatch = true;
                    }
                    
                    // 如果是文件，并且还没匹配上，则搜索内容
                    if (!isMatch && node.type === 'file' && node.content && node.content.toLowerCase().includes(lowerCaseQuery)) {
                        isMatch = true;
                    }

                    if (isMatch) {
                        // 可以返回节点的部分信息以提高性能，或返回完整对象
                        results.push(node);
                    }
                    
                    cursor.continue();
                } else {
                    // 游标结束
                    resolve(results);
                }
            };

            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    // 未来可以扩展更多复杂的搜索方法，例如：
    /*
    async complexSearch({ tags, users, dateRange, keywords }) {
        // 1. 根据 tags, users, dateRange 分别从各自的表中查询出 nodeId 集合。
        // 2. 求这些 nodeId 集合的交集。
        // 3. 对交集中的 nodeId，获取其内容并根据 keywords 进行过滤。
        // 4. 返回最终结果。
    }
    */
}
