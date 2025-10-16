// #config/repositories/ModuleRepository.js

import { STORAGE_KEYS, getModuleEventName } from '../shared/constants.js';

// V2: 在实际项目中，建议使用像 'uuid' 这样的专业库。
function generateUUID() {
    return 'node-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

/**
 * @fileoverview 管理特定工作区（由 `namespace` 标识）的类文件系统模块结构。
 * @description 每个 ModuleRepository 实例都与一个项目或工作区绑定，负责其内部所有文件和目录的增删改查。
 * [V2] 所有操作都基于持久的、唯一的节点ID，而不是可变的路径。
 * 它与全局的 TagRepository 和 LLMRepository 不同，不是单例。
 * @see 关于其管理的数据结构，请参阅 '../shared/types.js' 中的 {ModuleFSTree} 类型定义。
 */
export class ModuleRepository {
    /**
     * @param {string} namespace - 此仓库实例的唯一标识符 (例如, 一个项目ID)。
     * @param {import('../adapters/LocalStorageAdapter.js').LocalStorageAdapter} persistenceAdapter - 数据持久化适配器。
     * @param {import('../EventManager.js').EventManager} eventManager - 全局事件管理器。
     */
    constructor(namespace, persistenceAdapter, eventManager) {
        if (!namespace) {
            throw new Error("ModuleRepository 需要一个有效的命名空间。");
        }

        /** @private @type {string} */
        this.namespace = namespace;
        /** @private @type {import('../adapters/LocalStorageAdapter.js').LocalStorageAdapter} */
        this.adapter = persistenceAdapter;
        /** @private @type {import('../EventManager.js').EventManager} */
        this.eventManager = eventManager;
        /** @private @type {string} */
        this.storageKey = `${STORAGE_KEYS.MODULE_PREFIX}${this.namespace}`;

        /** 
         * 模块文件系统树的内存缓存。
         * @private
         * @type {import('../shared/types.js').ModuleFSTree | null} 
         */
        this.modules = null;

        /**
         * 一个在初始加载完成时解析的Promise。用于防止竞态条件和重复加载。
         * @private
         * @type {Promise<import('../shared/types.js').ModuleFSTree> | null}
         */
        this._loadingPromise = null;

        // --- [新增修复] ---
        // 引入一个异步写操作锁，通过Promise链来序列化所有写操作。
        // 这可以防止并发的异步修改导致竞态条件，特别是在未来替换为真正的异步存储（如IndexedDB）时至关重要。
        /**
         * @private
         * @type {Promise<any>}
         */
        this._writeLock = Promise.resolve();
    }

    /**
     * [新增修复] 封装一个私有方法来执行所有写操作。
     * 它将一个异步函数（写操作）添加到 Promise 链的末尾，确保操作按顺序执行。
     * @private
     * @template T
     * @param {() => Promise<T>} writeFn - 要执行的异步写操作函数。
     * @returns {Promise<T>}
     */
    _enqueueWrite(writeFn) {
        this._writeLock = this._writeLock.then(writeFn).catch(error => {
            console.error("在 ModuleRepository 中一个写操作失败:", error);
            // 即使失败，也要确保锁链继续，同时向上抛出错误以便调用者处理。
            throw error;
        });
        return this._writeLock;
    }


    /**
     * [SIMPLIFIED] 从持久化层加载模块树到内存中。
     * 此方法不再处理旧格式数据。如果存储中没有数据，则创建一个全新的空树。
     * @returns {Promise<import('../shared/types.js').ModuleFSTree>} 一个解析为模块树的Promise。
     */
    load() {
        if (this._loadingPromise) {
            return this._loadingPromise;
        }

        this._loadingPromise = (async () => {
            let storedTree = await this.adapter.getItem(this.storageKey);

            // 简化检查：如果存储中没有任何数据，则创建一个全新的、干净的 V2 树。
            if (!storedTree) {
                console.log(`[ModuleRepository] No data found for namespace '${this.namespace}'. Creating a new empty tree.`);
                storedTree = {
                    path: '/',
                    type: 'directory',
                    meta: {
                        id: 'root-' + this.namespace, // 为根节点生成一个确定的ID
                        ctime: new Date().toISOString(),
                        mtime: new Date().toISOString(),
                    },
                    children: []
                };
            }
            
            // 直接假定 storedTree 是有效的 V2 格式
            this.modules = storedTree;
            this.eventManager.publish(getModuleEventName('loaded', this.namespace), this.modules);
            return this.modules;
        })();
        
        return this._loadingPromise;
    }
    
    /**
     * 一个方便的公共获取器，它能确保在返回数据前，数据已被成功加载。
     * @returns {Promise<import('../shared/types.js').ModuleFSTree>}
     */
    async getModules() {
        return this.modules || await this.load();
    }

    /**
     * 将当前的内存模块树保存到持久化层。
     * @private
     */
    async _save() {
        if (this.modules) {
            await this.adapter.setItem(this.storageKey, this.modules);
        }
    }

    /**
     * [V2] 内部查找函数，基于稳定ID。
     * @private
     * @param {string} id - 要查找的节点的唯一ID。
     * @returns {{node: import('../shared/types.js').ModuleFSTreeNode, parent: import('../shared/types.js').ModuleFSTreeNode | null, index: number} | null} 
     *          一个包含节点本身、其父节点以及它在父节点children数组中索引的对象；如果未找到，则返回 null。
     */
    _findNodeById(id) {
        if (!this.modules) return null;
        if (this.modules.meta.id === id) return { node: this.modules, parent: null, index: -1 };
        
        const queue = [{ node: this.modules, parent: null, index: -1 }];
        while(queue.length > 0) {
            const { node: current } = queue.shift();
            if (current.children) {
                for (let i = 0; i < current.children.length; i++) {
                    const child = current.children[i];
                    if (child.meta.id === id) {
                        return { node: child, parent: current, index: i };
                    }
                    if (child.children) {
                        queue.push({ node: child });
                    }
                }
            }
        }
        return null;
    }


    /**
     * 向指定的父目录中添加一个新模块（文件或目录）。
     * @param {string | null} parentId - 父节点的唯一ID。如果为 `null`，则添加到根目录。
     * @param {Omit<import('../shared/types.js').ModuleFSTreeNode, 'path'>} moduleData - 新模块的数据。
     * @returns {Promise<import('../shared/types.js').ModuleFSTreeNode>} 返回新添加的模块节点。
     */
    async addModule(parentId, moduleData) {
        // [修改] 将写操作包裹在队列中
        return this._enqueueWrite(async () => {
            await this.getModules();
            
            // --- [核心修复] ---
            // 识别 `null` parentId 并将其显式映射到根节点的 ID。
            // 这是连接“逻辑根”（null）和“物理根”（根节点的实际ID）的关键。
            const effectiveParentId = parentId === null ? this.modules.meta.id : parentId;
            
            const parentResult = this._findNodeById(effectiveParentId);
            
            if (!parentResult || parentResult.node.type !== 'directory') {
                throw new Error(`父节点ID '${parentId}' 未找到或不是一个目录。`);
            }
            
            // --- [核心修复] ---
            // 引入一个递归函数来构建完整的节点树，确保所有子孙节点都有正确的 path 和 meta。
            const buildNodeTree = (nodeData, parentPath) => {
                const now = new Date().toISOString();
                const newId = generateUUID();
                
                // --- [最终修复] ---
                // 绝对可靠地获取节点名 (相对路径)
                // 1. 优先使用 nodeData.path
                // 2. 如果 path 无效, 回退到 nodeData.title
                // 3. 如果都无效, 生成一个默认名, 防止程序崩溃
                let nodeName = nodeData.path;
                if (typeof nodeName !== 'string' || !nodeName.trim()) {
                    nodeName = nodeData.type === 'directory' ? '新建文件夹' : '无标题';
                    console.warn('[ModuleRepository] 传入 addModule 的节点缺少有效的 path 或 title，已使用默认名称。传入数据:', nodeData);
                }

                const fullPath = (parentPath === '/' ? '' : parentPath) + '/' + nodeName.trim();

                const newNode = {
                    ...nodeData,
                    path: fullPath,
                    meta: { 
                        tags: [], 
                        ...nodeData.meta, 
                        id: newId, 
                        ctime: now, 
                        mtime: now 
                    }
                };
                
                // 删除临时的 title 属性，因为它不属于 ModuleFSTreeNode 结构
                delete newNode.title;
                
                if (Array.isArray(newNode.children)) {
                    newNode.children = newNode.children.map(childData => buildNodeTree(childData, fullPath));
                }

                return newNode;
            };

            const parentNode = parentResult.node;
            const newNode = buildNodeTree(moduleData, parentNode.path);

            parentNode.children.push(newNode);
            parentNode.meta.mtime = new Date().toISOString();
            
            // +++ DEBUG LOG +++
            console.log('[ModuleRepository] 即将保存的完整模块树:', JSON.parse(JSON.stringify(this.modules)));
            await this._save();
            
            this.eventManager.publish(getModuleEventName('node_added', this.namespace), {
                parentId: parentNode.meta.id,
                newNode: newNode
            });
            
            return newNode;
        });
    }
    
    /**
     * 从树中移除一个模块（文件或目录）。
     * @param {string} nodeId - 要移除的模块的唯一ID。
     * @returns {Promise<void>}
     */
    async removeModule(nodeId) {
        // [修改] 将写操作包裹在队列中
        return this._enqueueWrite(async () => {
            await this.getModules();
            const result = this._findNodeById(nodeId);
            if (!result) { console.warn(`模块ID '${nodeId}' 未找到，无法移除。`); return; }
            if (!result.parent) { throw new Error("不能移除根目录。"); }

            result.parent.children.splice(result.index, 1);
            result.parent.meta.mtime = new Date().toISOString();

            await this._save();
            
            this.eventManager.publish(getModuleEventName('node_removed', this.namespace), {
                parentId: result.parent.meta.id,
                removedNodeId: nodeId,
            });
        });
    }
    

    /**
     * 更新指定文件模块的内容。
     * @param {string} fileId - 节点的唯一ID。
     * @param {string} newContent - 文件的新内容。
     * @returns {Promise<void>}
     */
    async updateModuleContent(fileId, newContent) {
        // [修改] 将写操作包裹在队列中
        return this._enqueueWrite(async () => {
            await this.getModules();
            const result = this._findNodeById(fileId);
            if (!result || result.node.type !== 'file') throw new Error(`文件ID '${fileId}' 未找到。`);

            result.node.content = newContent;
            result.node.meta.mtime = new Date().toISOString();

            await this._save();
            
            this.eventManager.publish(getModuleEventName('node_content_updated', this.namespace), {
                updatedNode: result.node
            });
        });
    }

    /**
     * [新方法] 重命名一个文件或目录，并递归更新所有子路径。
     * @param {string} nodeId - 节点的唯一ID。
     * @param {string} newName
     * @returns {Promise<void>}
     */
    async renameModule(nodeId, newName) {
        // [修改] 将写操作包裹在队列中
        return this._enqueueWrite(async () => {
            await this.getModules();
            const result = this._findNodeById(nodeId);
            if (!result || !result.parent) throw new Error("节点未找到或为根节点，无法重命名。");

            const nodeToRename = result.node;
            const oldPath = nodeToRename.path;
            const parentPath = result.parent.path;
            const newPath = (parentPath === '/' ? '' : parentPath) + '/' + newName;
            
            const updateChildrenPaths = (currentNode, oldBasePath, newBasePath) => {
                currentNode.path = currentNode.path.replace(oldBasePath, newBasePath);
                if (currentNode.children) {
                    currentNode.children.forEach(child => updateChildrenPaths(child, oldBasePath, newBasePath));
                }
            };
            updateChildrenPaths(nodeToRename, oldPath, newPath);
            
            const now = new Date().toISOString();
            nodeToRename.meta.mtime = now;
            result.parent.meta.mtime = now;
            
            await this._save();
            
            this.eventManager.publish(getModuleEventName('node_renamed', this.namespace), {
                updatedNode: nodeToRename
            });
        });
    }

    /**
     * [V2] 批量更新一个或多个节点的元数据。
     * @param {Array<{id: string, meta: Partial<import('../shared/types.js').ModuleFSTreeNodeMeta>}>} updates
     */
    async updateNodesMeta(updates) {
        // [修改] 将写操作包裹在队列中
        return this._enqueueWrite(async () => {
            await this.getModules();
            const updatedNodes = [];
            const now = new Date().toISOString();
            
            for (const { id, meta } of updates) {
                const result = this._findNodeById(id);
                if (result && result.node) {
                    Object.assign(result.node.meta, meta);
                    result.node.meta.mtime = now;
                    updatedNodes.push(result.node);
                }
            }

            if (updatedNodes.length > 0) {
                await this._save();
                this.eventManager.publish(getModuleEventName('nodes_meta_updated', this.namespace), {
                    updatedNodes: updatedNodes
                });
            }
        });
    }

/**
 * [新增] 原子性地更新内容和元数据
 * @param {string} nodeId - 节点的唯一ID
 * @param {string} content - 新的内容
 * @param {object} metaUpdates - 要更新的元数据字段
 * @returns {Promise<void>}
 */
    async updateModuleContentAndMeta(nodeId, content, metaUpdates) {
    // [修复] 包裹在写队列中，确保并发安全
    return this._enqueueWrite(async () => {
        await this.getModules(); // 确保数据已加载
        
        // [核心修复] 正确解构返回值
        const result = this._findNodeById(nodeId);
        if (!result) {
            throw new Error(`节点 ${nodeId} 未找到`);
        }
        
        const { node } = result; // ✅ 正确获取实际的节点对象
        
        // 1. 更新内容
        node.content = content;
        
        // 2. 更新时间戳
        const now = new Date().toISOString();
        node.meta.mtime = now;
        
        // 3. 更新元数据（合并传入的更新）
        Object.assign(node.meta, metaUpdates);
        
        // 4. 持久化
        await this._save(); // ✅ 使用正确的方法名
        
        // 5. 只触发一个事件
        this.eventManager.publish(
            getModuleEventName('node_content_updated', this.namespace),
            { updatedNode: node }
        );
    });
    }

    /**
     * [V2-FIX] 新增：移动一个或多个节点到新的父节点下。
     * @param {string[]} nodeIds - 要移动的节点的ID数组。
     * @param {string} targetParentId - 目标父节点的ID。
     * @returns {Promise<void>}
     * @throws {Error} 如果移动操作非法。
     */
    async moveModules(nodeIds, targetParentId) {
        // [修改] 将写操作包裹在队列中
        return this._enqueueWrite(async () => {
            await this.getModules();

            if (!this._validateMove(nodeIds, targetParentId)) {
                throw new Error("无效的移动操作：不能将文件夹移动到其自身的子文件夹中。");
            }

            const targetParentResult = this._findNodeById(targetParentId);
            if (!targetParentResult || targetParentResult.node.type !== 'directory') {
                throw new Error(`目标父节点ID '${targetParentId}' 未找到或不是目录。`);
            }
            
            const nodesToMove = [];
            nodeIds.forEach(id => {
                const result = this._findNodeById(id);
                if (result && result.parent) {
                    const [removedNode] = result.parent.children.splice(result.index, 1);
                    nodesToMove.push(removedNode);
                }
            });

            if (nodesToMove.length === 0) return;

            const newParentPath = targetParentResult.node.path;
            nodesToMove.forEach(node => {
                const oldPath = node.path;
                const nodeName = oldPath.split('/').pop();
                const newPath = (newParentPath === '/' ? '' : newParentPath) + '/' + nodeName;
                
                const updateChildrenPaths = (currentNode, oldBasePath, newBasePath) => {
                    currentNode.path = currentNode.path.replace(oldBasePath, newBasePath);
                    if (currentNode.children) {
                        currentNode.children.forEach(child => updateChildrenPaths(child, oldBasePath, newBasePath));
                    }
                };
                updateChildrenPaths(node, oldPath, newPath);
                targetParentResult.node.children.push(node);
            });

            const now = new Date().toISOString();
            targetParentResult.node.meta.mtime = now;
            nodesToMove.forEach(node => node.meta.mtime = now);

            await this._save();

            // --- [核心修复] ---
            // 发布一个精确的 "nodes_moved" 事件，而不是通用的 "nodes_meta_updated"。
            // 这让UI层可以明确地知道这是一个结构变更操作，并调用正确的 reducer 来更新树状视图。
            this.eventManager.publish(getModuleEventName('nodes_moved', this.namespace), {
                movedNodeIds: nodeIds,
                targetParentId: targetParentId,
            });
        });
    }

    /**
     * [V2-FIX] 验证移动操作的合法性。
     * @private
     */
    _validateMove(nodeIds, newParentId) {
        for (const nodeId of nodeIds) {
            let currentTargetId = newParentId;
            while (currentTargetId) {
                if (currentTargetId === nodeId) {
                    // 找到了循环依赖：目标父节点是待移动节点的子孙
                    return false;
                }
                const parentResult = this._findNodeById(currentTargetId);
                currentTargetId = parentResult?.parent?.meta.id || null;
            }
        }
        return true;
    }
}
