// src/services/dbService.js

import { db } from '../common/db.js';

// 获取所有需要备份的表的名称
const tablesToBackup = Object.keys(db.tables.reduce((acc, table) => ({...acc, [table.name]: true }), {}));

/**
 * 导出整个 IndexedDB 数据库为 JSON 对象。
 * @returns {Promise<object>} 包含所有表数据的对象。
 */
export async function exportDatabase() {
    console.log("Starting database export for tables:", tablesToBackup);
    const exportedData = {};
    
    // 使用事务确保数据读取的一致性
    await db.transaction('r', tablesToBackup, async () => {
        for (const tableName of tablesToBackup) {
            // Check if the table actually exists in the DB before trying to read it
            if (db.table(tableName)) {
                console.log(`Exporting table: ${tableName}`);
                const tableData = await db.table(tableName).toArray();
                exportedData[tableName] = tableData;
            }
        }
    });

    console.log("Database export completed.");
    return exportedData;
}

/**
 * 从 JSON 对象导入数据到 IndexedDB，此操作会清空现有数据。
 * @param {object} data - 从文件解析出的包含所有表数据的对象。
 * @returns {Promise<void>}
 */
export async function importDatabase(data) {
    // 基础验证
    const importKeys = Object.keys(data);
    if (importKeys.length === 0 || !tablesToBackup.some(key => importKeys.includes(key))) {
        throw new Error("导入文件格式无效或不包含任何可识别的数据表。");
    }

    console.log("Starting database import...");

    // 使用事务来保证原子性：要么全部成功，要么全部失败
    await db.transaction('rw', tablesToBackup, async () => {
        for (const tableName of tablesToBackup) {
            if (data[tableName]) {
                console.log(`Clearing and importing table: ${tableName}`);
                // 1. 清空当前表
                await db.table(tableName).clear();
                // 2. 批量添加新数据
                await db.table(tableName).bulkAdd(data[tableName]);
            }
        }
    });

    console.log("Database import completed successfully.");
}
