// #vfs-core/db.js

/**
 * @fileoverview 底层 IndexedDB 封装类。
 * 提供数据库连接、版本升级和事务管理。
 */

// [修改] 导入默认名称和其它常量
import { DEFAULT_DB_NAME, DB_VERSION, OBJECT_STORES } from '../constants.js';

export class Database {
    // [修改] 构造函数接收 dbName
    constructor(dbName = DEFAULT_DB_NAME) {
        this.db = null; // 数据库实例
        this.dbName = dbName; // [新增] 存储数据库名称
    }

    /**
     * 连接并初始化数据库。
     * 如果数据库不存在或版本较低，会触发 onupgradeneeded 来创建/更新 schema。
     * @returns {Promise<IDBDatabase>} 数据库实例
     */
    async connect() {
        if (this.db) {
        console.warn("Database is already connected.");
            return this.db;
        }

        return new Promise((resolve, reject) => {
            // [修改] 使用 this.dbName 代替硬编码的常量
            const request = indexedDB.open(this.dbName, DB_VERSION);

            request.onerror = (event) => {
                // FIX: Cast event.target to IDBOpenDBRequest to access the 'error' property.
                // The 'errorCode' property is deprecated and does not exist on EventTarget.
                const error = (/** @type {IDBOpenDBRequest} */ (event.target)).error;
                console.error(`Database '${this.dbName}' error:`, error);
                reject(`Database error: ` + (error ? error.message : "Unknown error"));
            };

            request.onsuccess = (event) => {
                // FIX: Cast event.target to access the 'result' property.
                this.db = (/** @type {IDBOpenDBRequest} */ (event.target)).result;
                // [修改] 在日志中也使用动态名称
                console.log(`Database '${this.dbName}' connected successfully.`);
            this.verifyDatabaseStructure();
                resolve(this.db);
            };

            // [修改] 采用更健壮的顺序迁移逻辑
            request.onupgradeneeded = (/** @type {IDBVersionChangeEvent} */ event) => {
                console.log(`Upgrading database '${this.dbName}' from version ${event.oldVersion} to ${event.newVersion}...`);
                const db = (/** @type {IDBOpenDBRequest} */ (event.target)).result;
                const tx = (/** @type {IDBOpenDBRequest} */ (event.target)).transaction;

                // 按版本顺序执行升级
                if (event.oldVersion < 1) {
                    // 从 0 -> 1: 创建初始 Schema
                    this.createInitialSchema(db);
                }
                if (event.oldVersion < 2) {
                    // 从 0 或 1 -> 2: 执行 V2 升级
                    this.upgradeToVersion2(db, tx);
                }
                // 如果未来有 V3，可以在这里添加:
                // if (event.oldVersion < 3) {
                //     this.upgradeToVersion3(db, tx);
                // }

                console.log("Database upgrade complete.");
            };
        });
    }
    
    /**
     * @private 创建初始数据库 schema (V1)
     * @param {IDBDatabase} db
     */
    createInitialSchema(db) {
        console.log("Creating initial schema...");
        OBJECT_STORES.forEach(storeConfig => {
            if (!db.objectStoreNames.contains(storeConfig.name)) {
                const objectStore = db.createObjectStore(storeConfig.name, {
                    keyPath: storeConfig.keyPath,
                    autoIncrement: storeConfig.autoIncrement || false,
                });
                storeConfig.indexes.forEach(indexConfig => {
                    // [修复] 增加检查，防止重复创建
                    if (!objectStore.indexNames.contains(indexConfig.name)) {
                         objectStore.createIndex(indexConfig.name, indexConfig.keyPath, {
                            unique: indexConfig.unique || false,
                        });
                    }
                });
            }
        });
    }

    /**
     * @private 从 V1 升级到 V2 的逻辑
     * @param {IDBDatabase} db
     * @param {IDBTransaction | null} tx
     */
    upgradeToVersion2(db, tx) {
        console.log("Applying schema changes for version 2...");
        if (!tx) {
            console.error("Upgrade transaction is not available for v2 upgrade.");
            return;
        }
        try {
        const linksStore = tx.objectStore('links');
        
        // 🔍 添加调试日志
        console.log("[DB v2] Links store found, current indexes:", 
                    Array.from(linksStore.indexNames));
        
        // 检查并创建索引
        if (!linksStore.indexNames.contains('by_source')) {
            linksStore.createIndex('by_source', 'sourceNodeId', { unique: false });
            console.log("✅ Created index 'by_source' on 'links' table.");
        } else {
            console.log("ℹ️ Index 'by_source' already exists.");
        }
        
        if (!linksStore.indexNames.contains('by_target')) {
            linksStore.createIndex('by_target', 'targetNodeId', { unique: false });
            console.log("✅ Created index 'by_target' on 'links' table.");
        } else {
            console.log("ℹ️ Index 'by_target' already exists.");
        }
        
        // 🔍 验证索引是否创建成功
        console.log("[DB v2] After upgrade, indexes:", 
                    Array.from(linksStore.indexNames));
        
        } catch (error) {
            console.error("Failed to upgrade to version 2:", error);
            // 如果出错，可以决定是否中止事务
            tx.abort();
        }
    }

    /**
     * Starts a new transaction.
     * @param {string | string[]} storeNames The names of the object stores to include in the transaction.
     * @param {IDBTransactionMode} [mode='readonly'] The transaction mode.
     * @returns {Promise<IDBTransaction>} The transaction object.
     */
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
    // 🔍 详细的索引检查
    const availableIndexes = Array.from(store.indexNames);
    //console.log(`[DB Query] Store: ${storeName}, Looking for index: ${indexName}`);
    //console.log(`[DB Query] Available indexes:`, availableIndexes);
    
    if (!store.indexNames.contains(indexName)) {
        const error = new Error(
            `Index "${indexName}" not found in store "${storeName}".\n` +
            `Available indexes: ${availableIndexes.join(', ') || 'none'}\n` +
            `This usually means the database schema wasn't properly upgraded.`
        );
        console.error(error);
        throw error;
    }
        const index = store.index(indexName);
        return new Promise((resolve, reject) => {
            const request = index.getAll(query);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject((/** @type {IDBRequest} */ (event.target)).error);
        });
    }

    verifyDatabaseStructure() {
        console.group("[DB Verification] Checking database structure");
    
        const objectStoreNames = Array.from(this.db.objectStoreNames);
        console.log("Object stores:", objectStoreNames);
    
        // 创建一个只读事务来检查所有表
        const tx = this.db.transaction(objectStoreNames, 'readonly');
    
        objectStoreNames.forEach(storeName => {
            const store = tx.objectStore(storeName);
            const indexes = Array.from(store.indexNames);
            console.log(`📋 Store "${storeName}":`, {
                keyPath: store.keyPath,
                autoIncrement: store.autoIncrement,
                indexes: indexes
            });
        });
    
        console.groupEnd();
    }
}

// 导出单例
export const database = new Database();
