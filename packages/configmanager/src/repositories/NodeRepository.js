// #configManager/repositories/NodeRepository.js

/**
 * @fileoverview 负责 Node (文件/目录) 数据的持久化和复杂操作。
 */
import { v4 as uuidv4 } from 'uuid';
import { STORES, EVENTS } from '../constants.js';
// FIX: Import custom error classes to resolve 'Cannot find name' errors.
import { NotFoundError, ConflictError, TransactionError, ValidationError } from '../utils/errors.js';

export class NodeRepository {
    /**
     * @param {import('../db.js').Database} db - 数据库实例
     * @param {import('../EventManager.js').EventManager} eventManager
     */
    constructor(db, eventManager) {
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
                        parentRequest.onerror = (e) => rej((/** @type {IDBRequest} */(e.target)).error);
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
                        meta: {},};
                    const putRootRequest = store.put(rootNode);
                    await new Promise((res, rej) => {
                        putRootRequest.onsuccess = res;
                        putRootRequest.onerror = (e) => rej((/** @type {IDBRequest} */(e.target)).error);
                    });
                    
                    this.events.publish(EVENTS.NODE_ADDED, { newNode: rootNode, parentId: null });
                    parent = rootNode;
                }

                if (path !== '/') {
                    if (!parent) throw new NotFoundError(`Parent path "${parentPath}" not found`);
                    parentId = parent.id;
                }

                let finalPath = path;
                let finalName = name;
                let attempt = 0;
                const maxAttempts = 100;

                while (attempt < maxAttempts) {
                    const existingNode = await new Promise((res, rej) => {
                        const checkRequest = store.index('by_module_path').get([moduleName, finalPath]);
                        checkRequest.onsuccess = () => res(checkRequest.result);
                        checkRequest.onerror = (e) => rej((/** @type {IDBRequest} */(e.target)).error);
                    });

                    if (!existingNode) {
                        break;
                    }

                    attempt++;
                    finalName = `${name} (${attempt})`;
                    finalPath = parentPath === '/' ? `/${finalName}` : `${parentPath}/${finalName}`;
                    console.log(`[NodeRepository] Path "${path}" exists in module "${moduleName}",trying "${finalPath}"`);
                }

                if (attempt >= maxAttempts) {
                    throw new ConflictError(`Failed to create node: too many path conflicts for "${path}" in module "${moduleName}"`);
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
                    putNodeRequest.onerror = (e) => rej((/** @type {IDBRequest} */(e.target)).error);
                });
                
                tx.oncomplete = () => {
                    console.log(`[NodeRepository] Transaction for creating node "${node.name}" completed.`);
                    this.events.publish(EVENTS.NODE_ADDED, { newNode: node, parentId });
                    resolve(node);
                };

                tx.onerror = (event) => {
                    // FIX: Cast event.target
                    const error = (/** @type {IDBRequest} */(event.target)).error;
                    console.error("[NodeRepository] Transaction failed:", error);
                    reject(new TransactionError(error.message));
                };

            } catch (error) {
                tx.abort();
                reject(error);
            }
        });
    }
    
    /**
     * 根据 ID 获取节点
     * @param {string} nodeId
     * @returns {Promise<object|undefined>}
     */
    async getNode(nodeId) {
        const tx = await this.db.getTransaction(STORES.NODES, 'readonly');
        const store = tx.objectStore(STORES.NODES);
        return new Promise((resolve, reject) => {
            const request = store.get(nodeId);
            request.onsuccess = () => resolve(request.result);
            // FIX: Cast event.target
            request.onerror = (e) => reject((/** @type {IDBRequest} */(e.target)).error);
        });
    }
    
    /**
     * 更新节点信息
     * @param {string} nodeId
     * @param {object} updates - 要更新的字段
     * @returns {Promise<object>} 更新后的节点
     */
    async updateNode(nodeId, updates) {
        if (!nodeId) {
            throw new ValidationError("updateNode requires a valid nodeId");
        }

        const tx = await this.db.getTransaction(STORES.NODES, 'readwrite');
        const store = tx.objectStore(STORES.NODES);
        
        return new Promise(async (resolve, reject) => {
            try {
                const node = await new Promise((res, rej) => {
                    const req = store.get(nodeId);
                    req.onsuccess = () => res(req.result);
                    // FIX: Cast req.error via event.target
                    req.onerror = (e) => rej((/** @type {IDBRequest} */(e.target)).error);
                });

                if (!node) throw new NotFoundError(`Node with id ${nodeId} not found`);

                const updatedNode = { ...node, ...updates, updatedAt: new Date() };
                const putRequest = store.put(updatedNode);
                
                await new Promise((res, rej) => {
                   putRequest.onsuccess = res;
                   putRequest.onerror = (e) => rej((/** @type {IDBRequest} */(e.target)).error);
                });

                tx.oncomplete = () => {
                    if (updates.hasOwnProperty('content')) {
                        this.events.publish(EVENTS.NODE_CONTENT_UPDATED, { updatedNode });
                    } else {
                        this.events.publish(EVENTS.NODE_META_UPDATED, { updatedNode });
                    }
                    resolve(updatedNode);
                };
                // FIX: Cast event.target
                tx.onerror = (e) => reject(new TransactionError((/** @type {IDBRequest} */(e.target)).error.message));
            } catch (error) {
                tx.abort();
                reject(error);
            }
        });
    }

    /**
     * 【新增】在事务中更新节点内容（包含所有派生数据协调）
     * @param {string} nodeId
     * @param {string} newContent
     * @param {object} repos
     * @returns {Promise<object>}
     */
    async updateNodeContentWithTransaction(nodeId, newContent, repos) {
        const { srsRepo, taskRepo, agentRepo, linkRepo } = repos;
        
        // 使用一个大事务包裹所有操作
        const allStores = [STORES.NODES, STORES.SRS_CLOZES, STORES.TASKS, STORES.AGENTS, STORES.LINKS];
        const tx = await this.db.getTransaction(allStores, 'readwrite');
        
        return new Promise(async (resolve, reject) => {
            try {
                // 1. 协调 Clozes
                const { updatedContent: contentAfterClozes } = await srsRepo.reconcileClozes(nodeId, newContent, tx);
                
                // 2. 协调 Tasks
                const { updatedContent: contentAfterTasks } = await taskRepo.reconcileTasks(nodeId, contentAfterClozes, tx);
                
                // 3. 协调 Agents
                const { updatedContent: finalContent } = await agentRepo.reconcileAgents(nodeId, contentAfterTasks, tx);
                
                // 4. 更新链接（不修改内容）
                await linkRepo.updateLinksForNode(nodeId, finalContent, tx);
                
                // 5. 更新节点内容
                const store = tx.objectStore(STORES.NODES);
                const node = await new Promise((res, rej) => {
                    const req = store.get(nodeId);
                    req.onsuccess = () => res(req.result);
                    req.onerror = (e) => rej((/** @type {IDBRequest} */(e.target)).error);
                });
                
                if (!node) throw new NotFoundError(`Node with id ${nodeId} not found`);
                
                node.content = finalContent;
                node.updatedAt = new Date();
                
                await new Promise((res, rej) => {
                    const req = store.put(node);
                    req.onsuccess = res;
                    req.onerror = (e) => rej((/** @type {IDBRequest} */(e.target)).error);
                });
                
                tx.oncomplete = () => {
                    this.events.publish(EVENTS.NODE_CONTENT_UPDATED, { updatedNode: node });
                    resolve(node);
                };
                
                tx.onerror = (e) => {
                    // FIX: Cast event.target
                    const error = (/** @type {IDBRequest} */(e.target)).error;
                    console.error("[NodeRepository] Content update transaction failed:", error);
                    reject(new TransactionError(error.message));
                };
                
            } catch (error) {
                console.error("[NodeRepository] Error during content update, aborting transaction:", error);
                tx.abort();
                reject(error);
            }
        });
    }

    async moveNode(nodeId, newParentId) {
        const tx = await this.db.getTransaction(STORES.NODES, 'readwrite');
        const store = tx.objectStore(STORES.NODES);

        // FIX: Cast event.target
        const nodeToMove = await new Promise(r => store.get(nodeId).onsuccess = e => r((/** @type {IDBRequest} */(e.target)).result));
        const newParent = await new Promise(r => store.get(newParentId).onsuccess = e => r((/** @type {IDBRequest} */(e.target)).result));
        
        if (!nodeToMove) throw new NotFoundError("Node not found");
        if (!newParent) throw new NotFoundError("New parent not found");
        if (nodeToMove.moduleName !== newParent.moduleName) {
            throw new ConflictError("Cannot move nodes between different modules");
        }

        const oldPathPrefix = nodeToMove.path;
        const newPath = `${newParent.path === '/' ? '' : newParent.path}/${nodeToMove.name}`;

        const existingNodeAtPath = await new Promise((res, rej) => {
            const req = store.index('by_module_path').get([nodeToMove.moduleName, newPath]);
            req.onsuccess = () => res(req.result);
            req.onerror = (e) => rej((/** @type {IDBRequest} */(e.target)).error);
        });
        if (existingNodeAtPath) {
            throw new ConflictError(`Move failed: Path "${newPath}" already exists in module "${nodeToMove.moduleName}"`);
        }

        nodeToMove.parentId = newParentId;
        nodeToMove.path = newPath;
        nodeToMove.updatedAt = new Date();
        store.put(nodeToMove);

        if (nodeToMove.type === 'directory') {
            const pathIndex = store.index('by_path');
            const range = IDBKeyRange.bound(oldPathPrefix + '/', oldPathPrefix + '/\uffff');
            
            return new Promise((resolve, reject) => {
                const cursorRequest = pathIndex.openCursor(range);
                cursorRequest.onsuccess = (event) => {
                    // FIX: Cast event.target
                    const cursor = (/** @type {IDBRequest<IDBCursorWithValue>} */(event.target)).result;
                    if (cursor) {
                        const childNode = cursor.value;
                        childNode.path = childNode.path.replace(oldPathPrefix, newPath);
                        cursor.update(childNode);
                        cursor.continue();
                    } else {
                        resolve(nodeToMove);
                    }
                };
                cursorRequest.onerror = (e) => reject((/** @type {IDBRequest} */(e.target)).error);
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

        // FIX: Cast event.target
        const nodeToRename = await new Promise(r => store.get(nodeId).onsuccess = e => r((/** @type {IDBRequest} */(e.target)).result));
        if (!nodeToRename) throw new NotFoundError("Node not found");
        
        const oldPath = nodeToRename.path;
        const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/';
        const newPath = `${parentPath === '/' ? '' : parentPath}/${newName}`;

        // [修改] 检查重命名后的路径是否在同一模块下冲突
        const existingNode = await new Promise((res, rej) => {
            const checkRequest = store.index('by_module_path').get([nodeToRename.moduleName, newPath]);
            checkRequest.onsuccess = () => res(checkRequest.result);
            checkRequest.onerror = (e) => rej((/** @type {IDBRequest} */(e.target)).error);
        });

        if (existingNode && existingNode.id !== nodeId) {
            throw new ConflictError(`Rename failed: Path "${newPath}" already exists in module "${nodeToRename.moduleName}"`);
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
                const cursorRequest = pathIndex.openCursor(range);
                cursorRequest.onsuccess = (event) => {
                    // FIX: Cast event.target
                    const cursor = (/** @type {IDBRequest<IDBCursorWithValue>} */(event.target)).result;
                    if (cursor) {
                        const childNode = cursor.value;
                        childNode.path = childNode.path.replace(oldPath, newPath);
                        cursor.update(childNode);
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                cursorRequest.onerror = (e) => reject((/** @type {IDBRequest} */(e.target)).error);
            });
        }
        
        this.events.publish(EVENTS.NODE_RENAMED, { updatedNode: nodeToRename });
        return nodeToRename;
    }


    /**
     * 删除节点及其所有关联数据（这是一个原子操作）
     * @param {string} nodeId - 要删除的节点ID
     * @returns {Promise<{removedNodeId: string, allRemovedIds: string[]}>} An object containing the ID of the primary node removed and a list of all descendant IDs that were also removed.
     */
    async deleteNode(nodeId) {
        const allStoreNames = Object.values(STORES);
        const tx = await this.db.getTransaction(allStoreNames, 'readwrite');

        const nodesStore = tx.objectStore(STORES.NODES);
        // FIX: Cast event.target
        const node = await new Promise(r => nodesStore.get(nodeId).onsuccess = e => r((/** @type {IDBRequest} */(e.target)).result));
        if (!node) {
            return { removedNodeId: nodeId, allRemovedIds: [] };
        }

        const nodesToDelete = [node];
        if (node.type === 'directory') {
            const pathIndex = nodesStore.index('by_path');
            const range = IDBKeyRange.bound(node.path + '/', node.path + '/\uffff');
            // FIX: Cast event.target
            const allChildrenInPath = await new Promise(r => pathIndex.getAll(range).onsuccess = e => r((/** @type {IDBRequest} */(e.target)).result));
            const children = allChildrenInPath.filter(child => child.moduleName === node.moduleName);
            nodesToDelete.push(...children);
        }

        const nodeIdsToDelete = nodesToDelete.map(n => n.id);

        for (const id of nodeIdsToDelete) {
            nodesStore.delete(id);
            await this._deleteFromIndex(tx, STORES.NODE_TAGS, 'by_nodeId', id);
            await this._deleteFromIndex(tx, STORES.LINKS, 'by_source', id);
            await this._deleteFromIndex(tx, STORES.LINKS, 'by_target', id);
            await this._deleteFromIndex(tx, STORES.SRS_CLOZES, 'by_nodeId', id);
            await this._deleteFromIndex(tx, STORES.TASKS, 'by_nodeId', id);
            await this._deleteFromIndex(tx, STORES.AGENTS, 'by_nodeId', id);
        }
        
        this.events.publish(EVENTS.NODE_REMOVED, { removedNodeId: nodeId, allRemovedIds: nodeIdsToDelete });
        
        return { removedNodeId: nodeId, allRemovedIds: nodeIdsToDelete };
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
                // FIX: Cast event.target
                const cursor = (/** @type {IDBRequest<IDBCursor>} */(event.target)).result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            // FIX: Cast event.target
            request.onerror = (event) => reject((/** @type {IDBRequest} */(event.target)).error);
        });
    }
}
