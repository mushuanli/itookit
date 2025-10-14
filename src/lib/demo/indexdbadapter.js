// 文件: #demo/indexdbadapter.js (重构后)

import { IPersistenceAdapter } from '../common/interfaces/IPersistenceAdapter.js';


/**
 * @class IndexedDBAdapter
 * @description 使用浏览器 IndexedDB 实现的持久化适配器。
 * 每一个键值对都作为一条独立的记录存储在对象存储中。
 * @implements {IPersistenceAdapter}
 */
export class IndexedDBAdapter extends IPersistenceAdapter {
    /**
     * @param {object} [options]
     * @param {string} [options.dbName='mdx-app-db'] - 数据库名称。
     * @param {string} [options.storeName='keyval-store'] - 对象存储的名称。
     */
    constructor({ dbName = 'mdx-app-db', storeName = 'keyval-store' } = {}) {
        super();
        this.dbName = dbName;
        this.storeName = storeName;
        /** 
         * @private 
         * @type {Promise<IDBDatabase>} 
         */
        this.dbPromise = this._initDB();
    }

    /** 
     * @private 
     * 初始化 IndexedDB 数据库和对象存储。
     * @returns {Promise<IDBDatabase>}
     */
    _initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    // 使用 'key' 作为 keyPath，这样每条记录的键都是唯一的
                    db.createObjectStore(this.storeName, { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => {
                console.error("IndexedDB 错误:", event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * @override
     * @param {string} key - 要检索的数据的键。
     * @returns {Promise<any|null>}
     */
    async getItem(key) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, 'readonly');
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);

            request.onsuccess = () => {
                // 如果找到记录，返回其 `value` 属性，否则返回 null
                resolve(request.result ? request.result.value : null);
            };
            request.onerror = (event) => {
                console.error(`从 IndexedDB 获取键 "${key}" 失败:`, event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * @override
     * @param {string} key - 用于存储和检索数据的唯一键。
     * @param {any} value - 需要被存储的数据。
     * @returns {Promise<void>}
     */
    async setItem(key, value) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, 'readwrite');
            const store = transaction.objectStore(this.storeName);
            // 存储一个对象 { key: '...', value: ... } 以匹配 keyPath
            const request = store.put({ key, value });

            request.onsuccess = () => resolve();
            request.onerror = (event) => {
                console.error(`在 IndexedDB 中设置键 "${key}" 失败:`, event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * @override
     * @param {string} key - 要移除的数据的键。
     * @returns {Promise<void>}
     */
    async removeItem(key) {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = (event) => {
                console.error(`从 IndexedDB 移除键 "${key}" 失败:`, event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * @override
     * 清除此对象存储中的所有数据。
     * @returns {Promise<void>}
     */
    async clear() {
        const db = await this.dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this.storeName, 'readwrite');
            const store = transaction.objectStore(this.storeName);
            const request = store.clear(); // 使用 IndexedDB 的 clear() 方法

            request.onsuccess = () => resolve();
            request.onerror = (event) => {
                console.error(`清除 IndexedDB 对象存储 "${this.storeName}" 失败:`, event.target.error);
                reject(event.target.error);
            };
        });
    }
}