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
        const tx = await this.db.getTransaction(STORES.NODES, 'readwrite');
        const store = tx.objectStore(STORES.NODES);

        // --- START: MODIFICATION ---
        // 将所有数据库操作包裹在一个 Promise 中，以精确控制事务的完成
        return new Promise(async (resolve, reject) => {
            try {
                const pathSegments = path.split('/').filter(Boolean);
                const name = pathSegments.pop() || '';
                const parentPath = pathSegments.length > 0 ? '/' + pathSegments.join('/') : (path === '/' ? null : '/');

                let parentId = null;
                let parent = null;

                if (parentPath) {
                    // [修改] 查询父节点时，也应使用复合索引以确保正确性
                    const parentRequest = store.index('by_module_path').get([moduleName, parentPath]);
                    // 在同一个事务中等待请求结果
                    parent = await new Promise((res, rej) => {
                        parentRequest.onsuccess = () => res(parentRequest.result);
                        parentRequest.onerror = rej;
                    });
                }
                
                if (parentPath === '/' && !parent) {
                    console.warn(`Root path "/" not found for module "${moduleName}". Creating it automatically.`);
                    const rootId = `${moduleName}-root-${uuidv4()}`;
                    const now = new Date();
                    const rootNode = {
                        id: rootId,
                        type: 'directory',
                        moduleName,
                        path: '/',
                        name: '',
                        parentId: null,
                        createdAt: now,
                        updatedAt: now,
                        meta: {},
                    };
                    const putRootRequest = store.put(rootNode);
                    await new Promise((res, rej) => {
                        putRootRequest.onsuccess = res;
                        putRootRequest.onerror = rej;
                    });
                    
                    // 注意：这里发布的事件也在事务提交之前，但由于是根节点，通常不涉及立即的后续操作
                    this.events.publish(EVENTS.NODE_ADDED, { newNode: rootNode, parentId: null });
                    parent = rootNode;
                }

                if (path !== '/') {
                    if (!parent) throw new Error(`Parent path "${parentPath}" not found.`);
                    parentId = parent.id;
                }

                let finalPath = path;
                let finalName = name;
                let attempt = 0;
                const maxAttempts = 100;

                while (attempt < maxAttempts) {
                    // [修改] 检查当前路径在当前模块下是否存在
                    const existingNode = await new Promise((res, rej) => {
                        const checkRequest = store.index('by_module_path').get([moduleName, finalPath]);
                        checkRequest.onsuccess = () => res(checkRequest.result);
                        checkRequest.onerror = rej;
                    });

                    if (!existingNode) {
                        break;
                    }

                    attempt++;
                    finalName = `${name} (${attempt})`;
                    finalPath = parentPath === '/' ? `/${finalName}` : `${parentPath}/${finalName}`;
                    
                    console.log(`[NodeRepository] Path "${path}" exists in module "${moduleName}", trying "${finalPath}"`);
                }

                if (attempt >= maxAttempts) {
                    throw new Error(`Failed to create node: too many path conflicts for "${path}" in module "${moduleName}"`);
                }

                const id = `${moduleName}-${uuidv4()}`;
                const now = new Date();
                const node = {
                    id, 
                    type, 
                    moduleName, 
                    path: finalPath,
                    name: finalName,
                    parentId,
                    createdAt: now, 
                    updatedAt: now,
                    meta: extraData.meta || {},
                    content: extraData.content
                };
                
                const putNodeRequest = store.put(node);
                await new Promise((res, rej) => {
                    putNodeRequest.onsuccess = res;
                    putNodeRequest.onerror = rej;
                });
                
                // 监听事务的完成事件
                tx.oncomplete = () => {
                    console.log(`[NodeRepository] Transaction for creating node "${node.name}" completed.`);
                    // 只有在事务成功提交后，才发布事件并 resolve Promise
                    this.events.publish(EVENTS.NODE_ADDED, { newNode: node, parentId });
                    resolve(node);
                };

                tx.onerror = (event) => {
                    console.error("[NodeRepository] Transaction failed:", event.target.error);
                    reject(event.target.error);
                };

            } catch (error) {
                // 如果在 try 块内部发生任何错误，中止事务并拒绝 Promise
                tx.abort();
                reject(error);
            }
        });
        // --- END: MODIFICATION ---
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
        
        return new Promise(async (resolve, reject) => {
            try {
                const node = await new Promise((res, rej) => {
                    const req = store.get(nodeId);
                    req.onsuccess = () => res(req.result);
                    req.onerror = () => rej(req.error);
                });

                if (!node) throw new Error(`Node with id ${nodeId} not found.`);

                const updatedNode = { ...node, ...updates, updatedAt: new Date() };
                const putRequest = store.put(updatedNode);
                
                await new Promise((res, rej) => {
                   putRequest.onsuccess = res;
                   putRequest.onerror = rej;
                });

                tx.oncomplete = () => {
                    if (updates.hasOwnProperty('content')) {
                        this.events.publish(EVENTS.NODE_CONTENT_UPDATED, { updatedNode });
                    } else {
                        this.events.publish(EVENTS.NODE_META_UPDATED, { updatedNode });
                    }
                    resolve(updatedNode);
                };
                tx.onerror = (e) => reject(e.target.error);
                
            } catch (error) {
                tx.abort();
                reject(error);
            }
        });
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
        if (nodeToMove.moduleName !== newParent.moduleName) {
            throw new Error("Cannot move nodes between different modules yet."); // 跨模块移动是更复杂的操作
        }

        const oldPathPrefix = nodeToMove.path;
        const newPath = `${newParent.path === '/' ? '' : newParent.path}/${nodeToMove.name}`;

        // [新增] 检查移动后的路径是否冲突
        const existingNodeAtPath = await new Promise((res, rej) => {
            const req = store.index('by_module_path').get([nodeToMove.moduleName, newPath]);
            req.onsuccess = () => res(req.result);
            req.onerror = rej;
        });
        if (existingNodeAtPath) {
            throw new Error(`Move failed: Path "${newPath}" already exists in module "${nodeToMove.moduleName}".`);
        }

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

        // [修改] 检查重命名后的路径是否在同一模块下冲突
        const existingNode = await new Promise((res, rej) => {
            const checkRequest = store.index('by_module_path').get([nodeToRename.moduleName, newPath]);
            checkRequest.onsuccess = () => res(checkRequest.result);
            checkRequest.onerror = rej;
        });

        if (existingNode && existingNode.id !== nodeId) {
            throw new Error(`Rename failed: Path "${newPath}" already exists in module "${nodeToRename.moduleName}".`);
        }

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
            // [修改] 查找子节点时也需要考虑moduleName，以避免潜在的跨模块问题
            // 但由于当前逻辑是先找到父节点，再用父节点的path前缀匹配，所以暂时是安全的。
            // 理论上更安全的做法是 getAll(by_moduleName) 然后在内存中过滤path。
            const range = IDBKeyRange.bound(node.path + '/', node.path + '/\uffff');
            const allChildrenInPath = await new Promise(r => pathIndex.getAll(range).onsuccess = e => r(e.target.result));
            // 过滤出同一模块的子节点
            const children = allChildrenInPath.filter(child => child.moduleName === node.moduleName);
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
     * @param {(node: object) => boolean} [filter] - 一个可选的过滤器函数。如果提供了，只有函数返回 true 的文件节点或包含这些文件的文件夹才会被包含。
     * @returns {Promise<object|null>} ModuleFSTree-like object, or null if no nodes found.
     */
    async getTreeForModule(moduleName, filter) {
        const nodes = await this.db.getAllByIndex(STORES.NODES, 'by_moduleName', moduleName);
        if (nodes.length === 0) {
            console.log(`[NodeRepository] No nodes found for module "${moduleName}".`);
            return null;
        }

        let finalNodes;

        if (filter) {
            const nodeMap = new Map(nodes.map(node => [node.id, node]));
            const includedNodeIds = new Set();
            
            // 第一次遍历：找出所有直接满足条件的节点（文件或文件夹）
            for (const node of nodes) {
                if (filter(node)) {
                    includedNodeIds.add(node.id);
                }
            }

            if (includedNodeIds.size === 0) {
                console.log(`[NodeRepository] No nodes matched the filter for module "${moduleName}".`);
                return null;
            }

            const nodesToTrace = [...includedNodeIds];
            nodesToTrace.forEach(nodeId => {
                let current = nodeMap.get(nodeId);
                while (current && current.parentId) {
                    const parent = nodeMap.get(current.parentId);
                    if (!parent) break;
                    if (includedNodeIds.has(current.parentId)) break;
                    includedNodeIds.add(current.parentId);
                    current = parent;
                }
            });

            finalNodes = nodes.filter(node => includedNodeIds.has(node.id));
        } else {
            finalNodes = nodes;
        }
    
        const nodeMap = new Map(finalNodes.map(node => [node.id, { ...node, children: [] }]));
        const nodeMapIds = new Set(nodeMap.keys());
        let root = null;
    
        for (const node of finalNodes) {
            if (node.path === '/') {
                root = nodeMap.get(node.id);
                break;
            }
        }
    
        for (const node of finalNodes) {
            const mappedNode = nodeMap.get(node.id);
            if (node.parentId && nodeMapIds.has(node.parentId)) {
                nodeMap.get(node.parentId).children.push(mappedNode);
            } else if (!root && node.path === '/') {
                root = mappedNode;
            }
        }
    
        if (!root || finalNodes.some(n => !n.parentId || !nodeMapIds.has(n.parentId)) && finalNodes.length > 1) {
            console.log(`[NodeRepository] Creating virtual root for module "${moduleName}"`);
            
            const virtualRoot = {
                id: `${moduleName}-virtual-root`,
                type: 'directory',
                moduleName,
                path: '/',
                name: '',
                parentId: null,
                children: [],
                createdAt: new Date(),
                updatedAt: new Date(),
                meta: {}
            };
            
            for (const node of finalNodes) {
                const mappedNode = nodeMap.get(node.id);
                if (!node.parentId || !nodeMapIds.has(node.parentId)) {
                    if (root && root.children) {
                        const index = root.children.indexOf(mappedNode);
                        if (index > -1) root.children.splice(index, 1);
                    }
                    virtualRoot.children.push(mappedNode);
                }
            }
            
            root = virtualRoot;
        }
    
        if (!root) {
            console.warn(`[NodeRepository] Could not create root node for module "${moduleName}".`);
            return null;
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
