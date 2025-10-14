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
    }

    /**
     * 从持久化层加载模块树到内存中。
     * 此方法是可重入安全的：如果正在加载中，后续的并发调用将返回同一个正在加载中的Promise，而不会重新触发加载。
     * @returns {Promise<import('../shared/types.js').ModuleFSTree>} 一个解析为模块树的Promise。
     */
    load() {
        if (this._loadingPromise) {
            return this._loadingPromise;
        }

        this._loadingPromise = (async () => {
            let storedTree = await this.adapter.getItem(this.storageKey);
            if (!storedTree || !storedTree.meta?.id) { // [V2] 检查是否存在根ID，用于向后兼容
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
        const rootId = this.modules.meta.id;
        if (rootId === id) return { node: this.modules, parent: null, index: -1 };
        
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
     * @param {string} parentId - 父节点的唯一ID。
     * @param {Omit<import('../shared/types.js').ModuleFSTreeNode, 'path'>} moduleData - 新模块的数据，其`path`属性应为模块名。完整路径将自动构建。
     * @returns {Promise<import('../shared/types.js').ModuleFSTreeNode>} 返回新添加的模块节点。
     */
    async addModule(parentId, moduleData) {
        await this.getModules();
        const parentResult = this._findNodeById(parentId);
        if (!parentResult || parentResult.node.type !== 'directory') {
            throw new Error(`父节点ID '${parentId}' 未找到或不是一个目录。`);
        }
        
        const now = new Date().toISOString();
        const newId = generateUUID();
        const parentPath = parentResult.node.path;
        const fullPath = (parentPath === '/' ? '' : parentPath) + '/' + moduleData.path;
        const newNode = {
            ...moduleData,
            path: fullPath, // 覆盖为完整的、正确的路径
            meta: {
                tags: [],
                ...moduleData.meta,
                id: newId,
                ctime: now,
                mtime: now,
            }
        };

        parentResult.node.children.push(newNode);
        parentResult.node.meta.mtime = now;
        
        await this._save();
        
        // --- [核心改进] ---
        // 发布一个精确的“节点已添加”事件，而不是整个树
        this.eventManager.publish(getModuleEventName('node_added', this.namespace), {
            parentId: parentResult.node.meta.id,
            newNode: newNode
        });
        
        return newNode;
    }
    
    /**
     * 从树中移除一个模块（文件或目录）。
     * @param {string} nodeId - 要移除的模块的唯一ID。
     * @returns {Promise<void>}
     */
    async removeModule(nodeId) {
        await this.getModules();

        const result = this._findNodeById(nodeId);
        if (!result) { console.warn(`模块 '${path}' 未找到，无法移除。`); return; }
        if (!result.parent) { throw new Error("不能移除根目录。"); }

        result.parent.children.splice(result.index, 1);
        result.parent.meta.mtime = new Date().toISOString();

        await this._save();
        
        // --- [核心改进] ---
        // 发布一个精确的“节点已移除”事件
        this.eventManager.publish(getModuleEventName('node_removed', this.namespace), {
            parentId: result.parent.meta.id,
            removedNodeId: nodeId,
        });
    }
    

    /**
     * 更新指定文件模块的内容。
     * @param {string} fileId - 节点的唯一ID。
     * @param {string} newContent - 文件的新内容。
     * @returns {Promise<void>}
     */
    async updateModuleContent(fileId, newContent) {
        await this.getModules();
        const result = this._findNodeById(fileId);
        if (!result || result.node.type !== 'file') throw new Error(`文件ID '${fileId}' 未找到。`);

        result.node.content = newContent;
        result.node.meta.mtime = new Date().toISOString();

        await this._save();
        
        // --- [核心改进] ---
        // 发布一个精确的“节点已更新”事件
        this.eventManager.publish(getModuleEventName('node_content_updated', this.namespace), {
            updatedNode: result.node
        });
    }

    /**
     * [新方法] 重命名一个文件或目录，并递归更新所有子路径。
     * @param {string} nodeId - 节点的唯一ID。
     * @param {string} newName
     * @returns {Promise<void>}
     */
    async renameModule(nodeId, newName) {
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
        
        // --- [核心改进] ---
        // 重命名也被视为一种更新
        this.eventManager.publish(getModuleEventName('node_renamed', this.namespace), {
            updatedNode: nodeToRename
        });
    }

    /**
     * [V2] 批量更新一个或多个节点的元数据。
     * @param {Array<{id: string, meta: Partial<import('../shared/types.js').ModuleFSTreeNodeMeta>}>} updates
     */
    async updateNodesMeta(updates) {
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
    }

    /**
     * [V2-FIX] 新增：移动一个或多个节点到新的父节点下。
     * @param {string[]} nodeIds - 要移动的节点的ID数组。
     * @param {string} targetParentId - 目标父节点的ID。
     * @returns {Promise<void>}
     * @throws {Error} 如果移动操作非法。
     */
    async moveModules(nodeIds, targetParentId) {
        await this.getModules();

        if (!this._validateMove(nodeIds, targetParentId)) {
            throw new Error("无效的移动操作：不能将文件夹移动到其自身的子文件夹中。");
        }

        const targetParentResult = this._findNodeById(targetParentId);
        if (!targetParentResult || targetParentResult.node.type !== 'directory') {
            throw new Error(`目标父节点ID '${targetParentId}' 未找到或不是目录。`);
        }
        
        const nodesToMove = [];
        // 步骤1: 从树中找到所有待移动节点并从其旧父节点中移除
        nodeIds.forEach(id => {
            const result = this._findNodeById(id);
            if (result && result.parent) {
                const [removedNode] = result.parent.children.splice(result.index, 1);
                nodesToMove.push(removedNode);
            }
        });

        if (nodesToMove.length === 0) return; // 没有找到任何可移动的节点

        // 步骤2: 更新所有被移动节点及其子孙的路径，并将它们添加到新父节点
        const newParentPath = targetParentResult.node.path;
        nodesToMove.forEach(node => {
            const oldPath = node.path;
            const nodeName = oldPath.split('/').pop();
            const newPath = (newParentPath === '/' ? '' : newParentPath) + '/' + nodeName;
            
            // 递归更新路径
            const updateChildrenPaths = (currentNode, oldBasePath, newBasePath) => {
                currentNode.path = currentNode.path.replace(oldBasePath, newBasePath);
                if (currentNode.children) {
                    currentNode.children.forEach(child => updateChildrenPaths(child, oldBasePath, newBasePath));
                }
            };
            updateChildrenPaths(node, oldPath, newPath);
            
            // 添加到新父节点
            targetParentResult.node.children.push(node);
        });

        const now = new Date().toISOString();
        targetParentResult.node.meta.mtime = now;
        nodesToMove.forEach(node => node.meta.mtime = now);

        await this._save();

        // [V2-FIX] 发布一个统一的元数据更新事件，因为移动改变了多个节点的元数据（路径和mtime）
        // UI层可以通过这个事件来批量更新视图
        this.eventManager.publish(getModuleEventName('nodes_meta_updated', this.namespace), {
            updatedNodes: nodesToMove
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
