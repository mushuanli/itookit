/**
 * @fileoverview InodeStore - VNode 元数据存储
 */

import { VNode } from '../core/VNode.js';
import { VFS_STORES } from './VFSStorage.js';

export class InodeStore {
    constructor(db) {
        this.db = db;
        this.storeName = VFS_STORES.VNODES;
    }
    
    /**
     * 保存 VNode
     * @param {VNode} vnode
     * @param {import('../utils/Transaction.js').Transaction} [transaction]
     */
    async save(vnode, transaction = null) {
        const data = vnode.toJSON();
        
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
                request.onerror = (e) => {
                    const target = /** @type {IDBRequest} */ (e.target);
                    reject(target.error);
                };
            });
        }
    }
    
    /**
     * 加载 VNode
     * @param {string} nodeId
     * @returns {Promise<VNode|null>}
     */
    async load(nodeId) {
        const tx = await this.db.getTransaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        
        const data = await new Promise((resolve, reject) => {
            const request = store.get(nodeId);
            request.onsuccess = (e) => {
                const target = /** @type {IDBRequest} */ (e.target);
                resolve(target.result);
            };
            request.onerror = (e) => {
                const target = /** @type {IDBRequest} */ (e.target);
                reject(target.error);
            };
        });
        
        return data ? VNode.fromJSON(data) : null;
    }
    
    /**
     * 删除 VNode
     * @param {string} nodeId
     * @param {import('../utils/Transaction.js').Transaction} [transaction]
     */
    async delete(nodeId, transaction = null) {
        if (transaction) {
            const store = transaction.getStore(this.storeName);
            await new Promise((resolve, reject) => {
                const request = store.delete(nodeId);
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
                const request = store.delete(nodeId);
                request.onsuccess = () => resolve();
                request.onerror = (e) => {
                    const target = /** @type {IDBRequest} */ (e.target);
                    reject(target.error);
                };
            });
        }
    }
    
    /**
     * 根据路径获取 VNode ID
     * @param {string} module
     * @param {string} path
     * @returns {Promise<string|null>}
     */
    async getIdByPath(module, path) {
        const tx = await this.db.getTransaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const index = store.index('by_module_path');
        
        const data = await new Promise((resolve, reject) => {
            const request = index.get([module, path]);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        });
        
        return data ? data.id : null;
    }
    
    /**
     * 获取子节点
     * @param {string} parentId
     * @returns {Promise<VNode[]>}
     */
    async getChildren(parentId) {
        const allNodes = await this.db.getAllByIndex(
            this.storeName,
            'by_parent',
            parentId
        );
        
        return allNodes.map(data => VNode.fromJSON(data));
    }
    
    /**
     * 获取模块的所有节点
     * @param {string} moduleName
     * @returns {Promise<VNode[]>}
     */
    async getByModule(moduleName) {
        const allNodes = await this.db.getAllByIndex(
            this.storeName,
            'by_module',
            moduleName
        );
        
        return allNodes.map(data => VNode.fromJSON(data));
    }
    
    /**
     * 获取模块根节点
     * @param {string} moduleName
     * @returns {Promise<VNode|null>}
     */
    async getModuleRoot(moduleName) {
        const nodes = await this.getByModule(moduleName);
        const root = nodes.find(node => node.parent === null);
        
        return root || null;
    }
    
    /**
     * 批量加载
     * @param {string[]} nodeIds
     * @returns {Promise<VNode[]>}
     */
    async loadBatch(nodeIds) {
        const tx = await this.db.getTransaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        
        const results = await Promise.all(
            nodeIds.map(id => new Promise((resolve) => {
                const request = store.get(id);
                request.onsuccess = (e) => {
                    const data = e.target.result;
                    resolve(data ? VNode.fromJSON(data) : null);
                };
                request.onerror = () => resolve(null);
            }))
        );
        
        return results.filter(Boolean);
    }
}
