// #configManager/db.js

/**
 * @fileoverview 底层 IndexedDB 封装类。
 * 提供数据库连接、版本升级和事务管理。
 */

import { DB_NAME, DB_VERSION, OBJECT_STORES } from './constants.js';

class Database {
    constructor() {
        this.db = null; // 数据库实例
    }

    /**
     * 连接并初始化数据库。
     * 如果数据库不存在或版本较低，会触发 onupgradeneeded 来创建/更新 schema。
     * @returns {Promise<IDBDatabase>} 数据库实例
     */
    async connect() {
        if (this.db) {
            return this.db;
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error("Database error:", event.target.errorCode);
                reject("Database error: " + event.target.errorCode);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log("Database connected successfully.");
                resolve(this.db);
            };

            // 【修改】重构 onupgradeneeded 以支持版本化迁移
            request.onupgradeneeded = (event) => {
                console.log(`Upgrading database from version ${event.oldVersion} to ${event.newVersion}...`);
                const db = event.target.result;
                const tx = event.target.transaction;

                // 使用 switch 结构处理逐版本升级
                switch (event.oldVersion) {
                    case 0: // 从无到版本 1 的初始化
                        this.createInitialSchema(db);
                        // 注意：这里没有 break，以便新数据库可以顺序执行所有升级
                    
                    // [新增] 从版本 1 升级到版本 2 的逻辑
                    case 1: 
                        this.upgradeToVersion2(db, tx);
                        break;
                }
                console.log("Database upgrade complete.");
            };
        });
    }
    
    /**
     * @private 创建初始数据库 schema (V1)
     */
    createInitialSchema(db) {
        console.log("Creating initial schema for version 1...");
        OBJECT_STORES.forEach(storeConfig => {
            if (!db.objectStoreNames.contains(storeConfig.name)) {
                const objectStore = db.createObjectStore(storeConfig.name, {
                    keyPath: storeConfig.keyPath,
                    autoIncrement: storeConfig.autoIncrement || false,
                });
                storeConfig.indexes.forEach(indexConfig => {
                    objectStore.createIndex(indexConfig.name, indexConfig.keyPath, {
                        unique: indexConfig.unique || false,
                    });
                });
            }
        });
    }

    /**
     * @private [新增] 升级到版本 2 的逻辑
     */
    upgradeToVersion2(db, tx) {
        console.log("Applying schema changes for version 2...");
        try {
            // 获取 'nodes' 表的事务对象
            const nodesStore = tx.objectStore('nodes');
            
            // 1. 删除旧的 'by_path' 唯一索引
            if (nodesStore.indexNames.contains('by_path')) {
                nodesStore.deleteIndex('by_path');
                console.log("Deleted old index 'by_path'.");
            }
            
            // 2. 创建新的 'by_path' 非唯一索引
            nodesStore.createIndex('by_path', 'path', { unique: false });
            console.log("Created new non-unique index 'by_path'.");

            // 3. 创建新的复合唯一索引 'by_module_path'
            nodesStore.createIndex('by_module_path', ['moduleName', 'path'], { unique: true });
            console.log("Created new composite unique index 'by_module_path'.");

        } catch (error) {
            console.error("Failed to upgrade to version 2:", error);
            // 如果出错，可以决定是否中止事务
            tx.abort();
        }
    }

    async getTransaction(storeNames, mode = 'readonly') {
        if (!this.db) {
            await this.connect();
        }
        return this.db.transaction(storeNames, mode);
    }

    /**
     * 辅助函数：通过索引查询所有匹配项
     * @param {string} storeName - 表名
     * @param {string} indexName - 索引名
     * @param {IDBKeyRange | any} query - 查询条件
     * @returns {Promise<any[]>} 查询结果数组
     */
    async getAllByIndex(storeName, indexName, query) {
        const tx = await this.getTransaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const index = store.index(indexName);
        return new Promise((resolve, reject) => {
            const request = index.getAll(query);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(event.target.error);
        });
    }
}

// 导出单例
export const database = new Database();
