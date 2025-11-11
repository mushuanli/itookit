/**
 * @fileoverview VFSStorage - VFS 存储层
 * 适配 IndexedDB，提供统一的存储接口
 */

// [修改] 导入 Database 类本身，而不是它的单例实例
import { Database } from './db.js';
import { VNode } from '../core/VNode.js';
import { TransactionManager } from '../utils/Transaction.js';
import { InodeStore } from './InodeStore.js';
import { ContentStore } from './ContentStore.js';

// 存储常量
export const VFS_STORES = {
    VNODES: 'vnodes',           // VNode 元数据
    CONTENTS: 'vfs_contents',   // 文件内容
    MODULES: 'modules',         // 模块信息
    // 复用现有表
    SRS_CLOZES: 'srsClozes',
    TASKS: 'tasks',
    AGENTS: 'agents',
    LINKS: 'links',
    TAGS: 'tags',
    NODE_TAGS: 'nodeTags'
};

export class VFSStorage {
    constructor(options = {}) {
        // [修改] 核心改动：允许通过配置创建 Database 实例
        // 1. 如果外部直接传入了 db 实例，则使用它。
        // 2. 否则，根据 options.dbName 创建一个新的 Database 实例。
        // 3. 如果 options.dbName 也未提供，Database 类将使用其内部的默认名称。
        this.db = options.db || new Database(options.dbName);
        
        this.txManager = null;
        this.inodeStore = null;
        this.contentStore = null;
    }
    
    /**
     * 连接数据库
     */
    async connect() {
        await this.db.connect();
        
        this.txManager = new TransactionManager(this.db);
        this.inodeStore = new InodeStore(this.db);
        this.contentStore = new ContentStore(this.db);
        
        console.log('[VFSStorage] Connected');
    }
    
    /**
     * 开始事务
     * @param {string[]} [storeNames]
     * @param {IDBTransactionMode} [mode='readwrite']
     * @returns {Promise<import('../utils/Transaction.js').Transaction>}
     */
    async beginTransaction(storeNames, mode = 'readwrite') {
        const stores = storeNames || Object.values(VFS_STORES);
        return this.txManager.begin(stores, mode);
    }
    
    // ========== VNode 操作 ==========
    
    /**
     * 保存 VNode
     * @param {VNode} vnode
     * @param {import('../utils/Transaction.js').Transaction} [transaction]
     * @returns {Promise<void>}
     */
    async saveVNode(vnode, transaction = null) {
        return this.inodeStore.save(vnode, transaction);
    }
    
    /**
     * 加载 VNode
     * @param {string} nodeId
     * @returns {Promise<VNode|null>}
     */
    async loadVNode(nodeId) {
        return this.inodeStore.load(nodeId);
    }
    
    /**
     * 删除 VNode
     * @param {string} nodeId
     * @param {import('../utils/Transaction.js').Transaction} [transaction]
     * @returns {Promise<void>}
     */
    async deleteVNode(nodeId, transaction = null) {
        return this.inodeStore.delete(nodeId, transaction);
    }
    
    /**
     * 根据路径查询 VNode ID
     * @param {string} module
     * @param {string} path
     * @returns {Promise<string|null>}
     */
    async getNodeIdByPath(module, path) {
        return this.inodeStore.getIdByPath(module, path);
    }
    
    /**
     * 获取子节点
     * @param {string} parentId
     * @returns {Promise<VNode[]>}
     */
    async getChildren(parentId) {
        return this.inodeStore.getChildren(parentId);
    }
    
    /**
     * 批量加载 VNodes
     * @param {string[]} nodeIds
     * @returns {Promise<VNode[]>}
     */
    async loadVNodes(nodeIds) {
        return this.inodeStore.loadBatch(nodeIds);
    }
    
    // ========== 内容操作 ==========
    
    /**
     * 保存内容
     * @param {string} nodeId
     * @param {string} content
     * @param {import('../utils/Transaction.js').Transaction} [transaction]
     * @returns {Promise<string>} contentRef - 返回内容引用ID
     */
    async saveContent(nodeId, content, transaction = null) {
        return this.contentStore.save(nodeId, content, transaction);
    }
    
    /**
     * 加载内容
     * @param {string} contentRef
     * @returns {Promise<string>}
     */
    async loadContent(contentRef) {
        return this.contentStore.load(contentRef);
    }
    
    /**
     * 更新内容
     * @param {string} contentRef
     * @param {string} content
     * @param {import('../utils/Transaction.js').Transaction} [transaction]
     * @returns {Promise<void>}
     */
    async updateContent(contentRef, content, transaction = null) {
         this.contentStore.update(contentRef, content, transaction);
    }
    
    /**
     * 删除内容
     * @param {string} contentRef
     * @param {import('../utils/Transaction.js').Transaction} [transaction]
     * @returns {Promise<void>}
     */
    async deleteContent(contentRef, transaction = null) {
        if (contentRef) {
            return this.contentStore.delete(contentRef, transaction);
        }
    }
    
    // ========== 模块操作 ==========
    
    /**
     * 获取模块根节点
     * @param {string} moduleName
     * @returns {Promise<VNode|null>}
     */
    async getModuleRoot(moduleName) {
        return this.inodeStore.getModuleRoot(moduleName);
    }
    
    /**
     * 获取所有模块的 VNodes
     * @param {string} moduleName
     * @returns {Promise<VNode[]>}
     */
    async getModuleNodes(moduleName) {
        return this.inodeStore.getByModule(moduleName);
    }
}
