/**
 * @file vfsManager/utils/Transaction.js
 * @fileoverview Transaction - 事务管理器
 */

/**
 * 事务包装器
 */
export class Transaction {
    /**
     * @param {IDBTransaction} idbTransaction
     */
    constructor(idbTransaction) {
        /** @type {IDBTransaction} */
        this.idbTransaction = idbTransaction;
        this.operations = [];
        this.committed = false;
        this.rolledBack = false;
    }
    
    /**
     * 获取对象存储
     * @param {string} storeName
     * @returns {IDBObjectStore}
     */
    getStore(storeName) {
        return this.idbTransaction.objectStore(storeName);
    }
    
    /**
     * 添加操作到事务日志
     * @param {string} type
     * @param {object} data
     */
    log(type, data) {
        this.operations.push({
            type,
            data,
            timestamp: new Date()
        });
    }
    
    /**
     * 提交事务
     * @returns {Promise<void>}
     */
    async commit() {
        if (this.committed || this.rolledBack) {
            throw new Error('Transaction already finished');
        }
        
        return new Promise((resolve, reject) => {
            this.idbTransaction.oncomplete = () => {
                this.committed = true;
                resolve();
            };
            
            this.idbTransaction.onerror = (event) => {
                // 修正：明确类型转换
                const target = /** @type {IDBRequest} */ (event.target);
                const error = target.error;
                console.error('[Transaction] Commit failed:', error);
                reject(error);
            };
            
            this.idbTransaction.onabort = () => {
                reject(new Error('Transaction aborted'));
            };
        });
    }
    
    /**
     * 回滚事务
     */
    rollback() {
        if (this.committed || this.rolledBack) {
            throw new Error('Transaction already finished');
        }
        
        try {
            this.idbTransaction.abort();
            this.rolledBack = true;
        } catch (error) {
            console.error('[Transaction] Rollback failed:', error);
        }
    }
    
    /**
     * 获取事务统计
     * @returns {object}
     */
    getStats() {
        return {
            operationCount: this.operations.length,
            committed: this.committed,
            rolledBack: this.rolledBack
        };
    }
}

/**
 * 事务管理器
 */
export class TransactionManager {
    constructor(db) {
        this.db = db;
        this.activeTransactions = new Set();
    }
    
    /**
     * 开始新事务
     * @param {string[]} storeNames
     * @param {IDBTransactionMode} [mode='readwrite']
     * @returns {Promise<Transaction>}
     */
    async begin(storeNames, mode = 'readwrite') {
        const idbTx = await this.db.getTransaction(storeNames, mode);
        const tx = new Transaction(idbTx);
        
        this.activeTransactions.add(tx);
        
        // 事务完成后移除
        idbTx.oncomplete = () => {
            this.activeTransactions.delete(tx);
        };
        
        idbTx.onerror = () => {
            this.activeTransactions.delete(tx);
        };
        
        return tx;
    }
    
    /**
     * 获取活跃事务数量
     * @returns {number}
     */
    getActiveCount() {
        return this.activeTransactions.size;
    }
}
