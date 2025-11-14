// #configManager/utils/backup.js

import { DB_VERSION, STORES } from '../constants.js';

/**
 * 导出整个 IndexedDB 数据库为 JSON 对象。
 * @param {import('../db.js').Database} dbInstance - 数据库实例
 * @returns {Promise<object>} 包含所有数据的可序列化对象
 */
export async function exportDatabase(dbInstance) {
    const exportObject = {};
    const storeNames = Object.values(STORES);
    const tx = await dbInstance.getTransaction(storeNames, 'readonly');

    for (const storeName of storeNames) {
        const store = tx.objectStore(storeName);
        exportObject[storeName] = await new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            // FIX: Cast event.target to IDBRequest to access the 'error' property.
            request.onerror = (event) => reject((/** @type {IDBRequest} */(event.target)).error);
        });
    }

    return {
        meta: {
            version: DB_VERSION,
            exportedAt: new Date().toISOString(),
        },
        data: exportObject,
    };
}

/**
 * 将 JSON 对象导入到 IndexedDB 数据库中。
 * **警告：此操作会清空现有数据！**
 * @param {import('../db.js').Database} dbInstance - 数据库实例
 * @param {object} importData - 从 exportDatabase 获取的数据对象
 * @returns {Promise<void>}
 */
export async function importDatabase(dbInstance, importData) {
    if (!importData || !importData.meta || !importData.data) {
        throw new Error('Invalid import data format.');
    }
    // 可选：添加更严格的版本兼容性检查
    if (importData.meta.version > DB_VERSION) {
        throw new Error(`Import data version (${importData.meta.version}) is newer than database version (${DB_VERSION}). Please update the application.`);
    }

    const storeNames = Object.keys(importData.data);
    const tx = await dbInstance.getTransaction(storeNames, 'readwrite');

    // 监听事务错误
    tx.onerror = (event) => {
        // FIX: Cast event.target to IDBTransaction to access the 'error' property.
        console.error("Import transaction failed:", (/** @type {IDBTransaction} */(event.target)).error);
    };

    try {
        for (const storeName of storeNames) {
            // 确保 store 存在于当前 schema 中
            if (!Object.values(STORES).includes(storeName)) {
                console.warn(`Skipping import for unknown store: ${storeName}`);
                continue;
            }
            
            const store = tx.objectStore(storeName);
            // 1. 清空现有数据
            await new Promise((resolve, reject) => {
                const req = store.clear();
                req.onsuccess = resolve;
                req.onerror = (e) => reject((/** @type {IDBRequest} */(e.target)).error);
            });

            // 2. 写入新数据
            const records = importData.data[storeName];
            for (const record of records) {
                // put 操作是异步的，但在同一个事务中它们会排队执行
                store.put(record);
            }
        }
        
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            // FIX: Cast event.target to IDBTransaction to access the 'error' property.
            tx.onerror = (event) => reject((/** @type {IDBTransaction} */(event.target)).error); // 再次捕获以防万一
        });

    } catch (error) {
        console.error("Error during import process, aborting transaction.", error);
        tx.abort();
        throw error;
    }
}
