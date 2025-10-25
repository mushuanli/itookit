// #configManager/repositories/NodeRepository.js

/**
 * @fileoverview 负责 Node (文件/目录) 数据的持久化和复杂操作。
 */
import { v4 as uuidv4 } from 'uuid';
import { STORES, EVENTS } from '../constants.js';

export class NodeRepository {
    /**
     * @param {import('../db.js').Database} db - 数据库实例
     */
    constructor(db, eventManager) { // [修改] 注入 eventManager
        this.db = db;
        this.events = eventManager;
    }

    /**
     * 创建一个新节点（文件或目录）
     * @param {'file' | 'directory'} type - 节点类型
     * @param {string} moduleName - 所属模块名
     * @param {string} path - 完整路径 (e.g., /notes/project/task.md)
     * @param {object} extraData - 额外数据，如文件内容 { content: '...', meta: {...} }
     * @returns {Promise<object>} 创建的节点对象
     */
    async createNode(type, moduleName, path, extraData = {}) {
        const pathSegments = path.split('/').filter(Boolean);
        const name = pathSegments.pop() || '';
        // [修正] 修正 parentPath 的计算逻辑，确保根目录的父路径为 null
        const parentPath = pathSegments.length > 0 ? '/' + pathSegments.join('/') : (path === '/' ? null : '/');

        const tx = await this.db.getTransaction(STORES.NODES, 'readwrite');
        const store = tx.objectStore(STORES.NODES);
        const index = store.index('by_path');

        let parentId = null;
        let parent = null;

        // [修正] 只有在需要父目录时才查找
        if (parentPath) {
            const parentRequest = index.get(parentPath);
            parent = await new Promise((resolve, reject) => {
                parentRequest.onsuccess = () => resolve(parentRequest.result);
                parentRequest.onerror = reject;
            });
        }

        // [核心修正] 如果父目录是根目录 ("/") 但它不存在，则自动创建它。
        // 这通常发生在为一个新模块创建第一个文件/目录时。
        if (parentPath === '/' && !parent) {
            console.warn(`Root path "/" not found for module "${moduleName}". Creating it automatically.`);
            const rootId = `${moduleName}-root-${uuidv4()}`;
            const now = new Date();
            const rootNode = {
                id: rootId,
                type: 'directory',
                moduleName,
                path: '/',
                name: '', // 根目录没有名字
                parentId: null,
                createdAt: now,
                updatedAt: now,
                meta: {},
            };
            await store.put(rootNode);
            this.events.publish(EVENTS.NODE_ADDED, { newNode: rootNode, parentId: null });
            
            // 将自动创建的根节点作为当前操作的父节点
            parent = rootNode; 
        }

        if (path !== '/') {
            if (!parent) throw new Error(`Parent path "${parentPath}" not found.`);
            parentId = parent.id;
        }

        const id = `${moduleName}-${uuidv4()}`;
        const now = new Date();
        const node = {
            id,
            type,
            moduleName,
            path,
            name,
            parentId,
            createdAt: now,
            updatedAt: now,
            // [修改] 确保 meta 字段总是存在
            meta: extraData.meta || {}, 
            content: extraData.content
        };
        
        await store.put(node);
        this.events.publish(EVENTS.NODE_ADDED, { newNode: node, parentId }); // [修改] 发布事件
        return node;
    }
    
    /**
     * 根据 ID 获取节点
     * @param {string} nodeId
     * @returns {Promise<object|undefined>}
     */
    async getNode(nodeId) {
        const tx = await this.db.getTransaction(STORES.NODES, 'readonly');
        const store = tx.objectStore(STORES.NODES);
        return new Promise((resolve, reject) => { // [FIX]
            const request = store.get(nodeId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }
    
    /**
     * 更新节点信息
     * @param {string} nodeId
     * @param {object} updates - 要更新的字段
     * @returns {Promise<object>} 更新后的节点
     */
    async updateNode(nodeId, updates) {
        // 【修复】增加ID校验，防止向数据库传递 undefined 的 key
        if (!nodeId) {
            throw new Error("updateNode 方法需要一个有效的 nodeId。");
        }

        const tx = await this.db.getTransaction(STORES.NODES, 'readwrite');
        const store = tx.objectStore(STORES.NODES);
        const node = await new Promise((resolve, reject) => { // [FIX]
            const request = store.get(nodeId);
            request.onsuccess = e => resolve(e.target.result);
            request.onerror = e => reject(e.target.error);
        });
        
        if (!node) throw new Error(`Node with id ${nodeId} not found.`);

        const updatedNode = { ...node, ...updates, updatedAt: new Date() };
        await store.put(updatedNode);
        
        // [修改] 根据更新内容发布不同事件
        if (updates.hasOwnProperty('content')) {
             this.events.publish(EVENTS.NODE_CONTENT_UPDATED, { updatedNode });
        } else {
             this.events.publish(EVENTS.NODE_META_UPDATED, { updatedNode });
        }
        
        return updatedNode;
    }

    /**
     * 移动节点到新的父目录下
     * @param {string} nodeId - 要移动的节点ID
     * @param {string} newParentId - 新的父节点ID
     * @returns {Promise<object>} 移动后的节点
     */
    async moveNode(nodeId, newParentId) {
        const tx = await this.db.getTransaction(STORES.NODES, 'readwrite');
        const store = tx.objectStore(STORES.NODES);

        const nodeToMove = await new Promise(r => store.get(nodeId).onsuccess = e => r(e.target.result));
        const newParent = await new Promise(r => store.get(newParentId).onsuccess = e => r(e.target.result));
        
        if (!nodeToMove || !newParent) throw new Error("Node or new parent not found.");

        const oldPathPrefix = nodeToMove.path;
        const newPath = `${newParent.path === '/' ? '' : newParent.path}/${nodeToMove.name}`;

        // 1. 更新节点本身
        nodeToMove.parentId = newParentId;
        nodeToMove.path = newPath;
        nodeToMove.updatedAt = new Date();
        store.put(nodeToMove);

        // 2. 如果是目录，递归更新所有子节点的路径
        if (nodeToMove.type === 'directory') {
            const pathIndex = store.index('by_path');
            const range = IDBKeyRange.bound(oldPathPrefix + '/', oldPathPrefix + '/\uffff');
            
            return new Promise((resolve, reject) => {
                pathIndex.openCursor(range).onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        const childNode = cursor.value;
                        childNode.path = childNode.path.replace(oldPathPrefix, newPath);
                        cursor.update(childNode);
                        cursor.continue();
                    } else {
                        resolve(nodeToMove); // 游标结束，完成
                    }
                };
                pathIndex.openCursor(range).onerror = reject;
            });
        }
        
        // 移动完成后
        this.events.publish(EVENTS.NODE_MOVED, { nodeId, newParentId, updatedNode: nodeToMove }); // [修改] 发布事件
        return nodeToMove;
    }

    /**
     * [移植新增] 重命名一个节点，并递归更新其所有子节点的路径。
     * @param {string} nodeId
     * @param {string} newName
     * @returns {Promise<object>}
     */
    async renameNode(nodeId, newName) {
        const tx = await this.db.getTransaction(STORES.NODES, 'readwrite');
        const store = tx.objectStore(STORES.NODES);

        const nodeToRename = await new Promise(r => store.get(nodeId).onsuccess = e => r(e.target.result));
        if (!nodeToRename) throw new Error("Node not found.");
        
        const oldPath = nodeToRename.path;
        const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
        const newPath = `${parentPath === '/' ? '' : parentPath}/${newName}`;

        // 更新自身
        nodeToRename.name = newName;
        nodeToRename.path = newPath;
        nodeToRename.updatedAt = new Date();
        store.put(nodeToRename);

        // 递归更新子节点
        if (nodeToRename.type === 'directory') {
            const pathIndex = store.index('by_path');
            const range = IDBKeyRange.bound(oldPath + '/', oldPath + '/\uffff');
            
            await new Promise((resolve, reject) => {
                pathIndex.openCursor(range).onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        const childNode = cursor.value;
                        childNode.path = childNode.path.replace(oldPath, newPath);
                        cursor.update(childNode);
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                pathIndex.openCursor(range).onerror = reject;
            });
        }
        
        this.events.publish(EVENTS.NODE_RENAMED, { updatedNode: nodeToRename });
        return nodeToRename;
    }


    /**
     * 删除节点及其所有关联数据（这是一个原子操作）
     * @param {string} nodeId - 要删除的节点ID
     * @returns {Promise<void>}
     */
    async deleteNode(nodeId) {
        // 事务必须包含所有可能被修改的表
        const allStoreNames = Object.values(STORES);
        const tx = await this.db.getTransaction(allStoreNames, 'readwrite');

        const nodesStore = tx.objectStore(STORES.NODES);
        const node = await new Promise(r => nodesStore.get(nodeId).onsuccess = e => r(e.target.result));
        if (!node) return; // 节点不存在，直接返回

        const nodesToDelete = [node];
        // 如果是目录，找到所有子孙节点
        if (node.type === 'directory') {
            const pathIndex = nodesStore.index('by_path');
            const range = IDBKeyRange.bound(node.path + '/', node.path + '/\uffff');
            const children = await new Promise(r => pathIndex.getAll(range).onsuccess = e => r(e.target.result));
            nodesToDelete.push(...children);
        }

        const nodeIdsToDelete = nodesToDelete.map(n => n.id);

        for (const id of nodeIdsToDelete) {
            // 1. 删除节点本身
            nodesStore.delete(id);

            // 2. 删除关联数据
            await this._deleteFromIndex(tx, STORES.NODE_TAGS, 'by_nodeId', id);
            await this._deleteFromIndex(tx, STORES.LINKS, 'by_source', id);
            await this._deleteFromIndex(tx, STORES.LINKS, 'by_target', id);
            await this._deleteFromIndex(tx, STORES.SRS_CLOZES, 'by_nodeId', id);
            await this._deleteFromIndex(tx, STORES.TASKS, 'by_nodeId', id);
            await this._deleteFromIndex(tx, STORES.AGENTS, 'by_nodeId', id);
        }
        
        this.events.publish(EVENTS.NODE_REMOVED, { removedNodeId: nodeId, allRemovedIds: nodeIdsToDelete }); // [修改] 发布事件
    }

    /**
     * [核心改进] 获取并重建指定模块的文件树，支持过滤。
     * @param {string} moduleName
     * @param {(node: object) => boolean} [filter] - 一个可选的过滤器函数。如果提供了，只有函数返回 true 的文件节点会被包含在最终的树中。文件夹节点总是会被包含，以维持结构。
     * @returns {Promise<object|null>} ModuleFSTree-like object, or null if no nodes found.
     */
    async getTreeForModule(moduleName, filter) {
        const nodes = await this.db.getAllByIndex(STORES.NODES, 'by_moduleName', moduleName);
        if (nodes.length === 0) return null;

        let finalNodes;

        if (filter) {
            const nodeMap = new Map(nodes.map(node => [node.id, node]));
            const includedFileIds = new Set();
            
            // 第一次遍历：找出所有符合条件的文件
            for (const node of nodes) {
                if (node.type === 'file' && filter(node)) {
                    includedFileIds.add(node.id);
                }
            }

            const includedNodeIds = new Set(includedFileIds);

            // 第二次遍历：为每个符合条件的文件，将其所有祖先文件夹都包含进来
            includedFileIds.forEach(fileId => {
                let current = nodeMap.get(fileId);
                while (current && current.parentId) {
                    includedNodeIds.add(current.parentId);
                    current = nodeMap.get(current.parentId);
                }
            });

            // 最终的节点列表是所有符合条件的文件及其所有祖先文件夹
            finalNodes = nodes.filter(node => includedNodeIds.has(node.id) || node.type === 'directory');

            // 如果过滤后没有任何文件，我们可能只想显示空的文件夹结构
            // 或者根据产品需求返回 null。这里我们选择显示空文件夹结构。
            if (includedFileIds.size === 0) {
                 finalNodes = nodes.filter(node => node.type === 'directory');
            }
        } else {
            // 如果没有过滤器，使用所有节点
            finalNodes = nodes;
        }
        
        if (finalNodes.length === 0) return null;

        // --- 以下是树构建逻辑，保持不变 ---
        const nodeMap = new Map(finalNodes.map(node => [node.id, { ...node, children: [] }]));
        let root = null;
        
        // 使用 finalNodes 构建树
        for (const node of finalNodes) {
            const mappedNode = nodeMap.get(node.id);
            if (node.parentId && nodeMap.has(node.parentId)) {
                nodeMap.get(node.parentId).children.push(mappedNode);
            } else if (node.path === '/') {
                root = mappedNode;
            }
        }
        
        // 如果过滤导致根节点丢失（不太可能，但作为防御），找到顶层节点作为根
        if (!root) {
            const topLevelNodes = [];
            for (const node of finalNodes) {
                 if (!node.parentId || !nodeMap.has(node.parentId)) {
                     // 假设根节点 path 为 '/'
                     if(node.path === '/') root = nodeMap.get(node.id);
                 }
            }
        }

        return root;
    }


    /**
     * @private 内部辅助函数，用于从指定索引中删除所有匹配项
     */
    async _deleteFromIndex(tx, storeName, indexName, key) {
        const store = tx.objectStore(storeName);
        const index = store.index(indexName);
        return new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.only(key));
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = reject;
        });
    }
}
