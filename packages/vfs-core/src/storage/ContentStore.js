/**
 * @fileoverview ContentStore - 文件内容存储
 */

import { VFS_STORES } from './VFSStorage.js';

export class ContentStore {
    constructor(db) {
        this.db = db;
        this.storeName = VFS_STORES.CONTENTS;
    }
    
    /**
     * 保存内容
     * @param {string} nodeId
     * @param {string} content
     * @param {import('../utils/Transaction.js').Transaction} [transaction]
     * @returns {Promise<string>} contentRef
     */
    async save(nodeId, content, transaction = null) {
        const contentRef = `content-${nodeId}`;
        const data = {
            ref: contentRef,
            nodeId,
            content,
            size: content.length,
            createdAt: new Date()
        };
        
        if (transaction) {
            const store = transaction.getStore(this.storeName);
            await new Promise((resolve, reject) => {
                const request = store.put(data);
                request.onsuccess = () => resolve();
                request.onerror = (e) => {
                    const target = /** @type {IDBRequest} */ (e.target);
                    reject(target.error);
                };
            });
        } else {
            const tx = await this.db.getTransaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            await new Promise((resolve, reject) => {
                const request = store.put(data);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        }
        
        return contentRef;
    }
    
    /**
     * 加载内容
     * @param {string} contentRef
     * @returns {Promise<string>}
     */
    async load(contentRef) {
        const tx = await this.db.getTransaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        
        const data = await new Promise((resolve, reject) => {
            const request = store.get(contentRef);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
        
        return data ? data.content : '';
    }
    
    /**
     * 更新内容
     * @param {string} contentRef
     * @param {string} content
     * @param {import('../utils/Transaction.js').Transaction} [transaction]
     */
    async update(contentRef, content, transaction = null) {
        const nodeId = contentRef.replace('content-', '');
        return this.save(nodeId, content, transaction);
    }
    
    /**
     * 删除内容
     * @param {string} contentRef
     * @param {import('../utils/Transaction.js').Transaction} [transaction]
     */
    async delete(contentRef, transaction = null) {
        if (transaction) {
            const store = transaction.getStore(this.storeName);
            await new Promise((resolve, reject) => {
                const request = store.delete(contentRef);
                request.onsuccess = () => resolve();
                request.onerror = (e) => {
                    const target = /** @type {IDBRequest} */ (e.target);
                    reject(target.error);
                };
            });
        } else {
            const tx = await this.db.getTransaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            await new Promise((resolve, reject) => {
                const request = store.delete(contentRef);
                request.onsuccess = () => resolve();
                request.onerror = (e) => reject(e.target.error);
            });
        }
    }
}
