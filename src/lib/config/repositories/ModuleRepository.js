// #config/repositories/ModuleRepository.js

import { STORAGE_KEYS, getModuleEventName } from '../shared/constants.js';

/**
 * @fileoverview 管理特定工作区（由 `namespace` 标识）的类文件系统模块结构。
 * @description 每个 ModuleRepository 实例都与一个项目或工作区绑定，负责其内部所有文件和目录的增删改查。
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
            const storedTree = await this.adapter.getItem(this.storageKey);
            
            // 如果存储中没有数据，则初始化一个默认的根目录结构。
            this.modules = storedTree || {
                path: '/',
                type: 'directory',
                meta: {
                    ctime: new Date().toISOString(),
                    mtime: new Date().toISOString(),
                },
                children: []
            };

            // 发布加载完成事件，以便UI可以响应。
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
     * 通过其完整路径在树中查找一个节点。
     * @private
     * @param {string} path - 要查找的节点的完整路径 (例如, '/src/components/Button.js')。
     * @returns {{node: import('../shared/types.js').ModuleFSTreeNode, parent: import('../shared/types.js').ModuleFSTreeNode | null, index: number} | null} 
     *          一个包含节点本身、其父节点以及它在父节点children数组中索引的对象；如果未找到，则返回 null。
     */
    _findNodeByPath(path) {
        if (!this.modules) return null;
        if (path === '/') return { node: this.modules, parent: null, index: -1 };

        const parts = path.split('/').filter(p => p);
        let currentNode = this.modules;
        let parent = null;
        let index = -1;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!currentNode.children) return null;
            
            parent = currentNode;
            index = currentNode.children.findIndex(child => child.path.endsWith(`/${part}`));
            
            if (index === -1) return null;
            currentNode = currentNode.children[index];
        }

        return { node: currentNode, parent, index };
    }


    /**
     * 向指定的父目录中添加一个新模块（文件或目录）。
     * @param {string} parentPath - 父目录的完整路径。
     * @param {Omit<import('../shared/types.js').ModuleFSTreeNode, 'path'>} moduleData - 新模块的数据，其`path`属性应为模块名。完整路径将自动构建。
     * @returns {Promise<import('../shared/types.js').ModuleFSTreeNode>} 返回新添加的模块节点。
     */
    async addModule(parentPath, moduleData) {
        await this.getModules();
        
        const parentResult = this._findNodeByPath(parentPath);
        if (!parentResult || parentResult.node.type !== 'directory') {
            throw new Error(`父目录 '${parentPath}' 未找到或不是一个目录。`);
        }
        
        const fullPath = (parentPath === '/' ? '' : parentPath) + '/' + moduleData.path;
        const newNode = {
            ...moduleData,
            path: fullPath, // 覆盖为完整的、正确的路径
            meta: {
                ...moduleData.meta,
                ctime: new Date().toISOString(),
                mtime: new Date().toISOString(),
            }
        };

        parentResult.node.children.push(newNode);
        parentResult.node.meta.mtime = new Date().toISOString(); // 更新父目录的修改时间

        await this._save();
        
        // --- [核心改进] ---
        // 发布一个精确的“节点已添加”事件，而不是整个树
        this.eventManager.publish(getModuleEventName('node_added', this.namespace), {
            parentPath: parentResult.node.path,
            newNode: newNode
        });
        
        return newNode;
    }

    /**
     * 更新指定文件模块的内容。
     * @param {string} filePath - 要更新的文件的完整路径。
     * @param {string} newContent - 文件的新内容。
     * @returns {Promise<void>}
     */
    async updateModuleContent(filePath, newContent) {
        await this.getModules();
        
        const result = this._findNodeByPath(filePath);
        if (!result || result.node.type !== 'file') {
            throw new Error(`路径 '${filePath}' 对应的文件未找到。`);
        }

        result.node.content = newContent;
        result.node.meta.mtime = new Date().toISOString();

        await this._save();
        
        // --- [核心改进] ---
        // 发布一个精确的“节点已更新”事件
        this.eventManager.publish(getModuleEventName('node_updated', this.namespace), {
            updatedNode: result.node
        });
    }
    
    /**
     * 从树中移除一个模块（文件或目录）。
     * @param {string} path - 要移除的模块的完整路径。
     * @returns {Promise<void>}
     */
    async removeModule(path) {
        await this.getModules();

        const result = this._findNodeByPath(path);
        if (!result) { console.warn(`模块 '${path}' 未找到，无法移除。`); return; }
        if (!result.parent) { throw new Error("不能移除根目录。"); }

        result.parent.children.splice(result.index, 1);
        result.parent.meta.mtime = new Date().toISOString();

        await this._save();
        
        // --- [核心改进] ---
        // 发布一个精确的“节点已移除”事件
        this.eventManager.publish(getModuleEventName('node_removed', this.namespace), {
            parentPath: result.parent.path,
            removedNodePath: path
        });
    }
    
    /**
     * [新方法] 重命名一个文件或目录，并递归更新所有子路径。
     * @param {string} oldPath
     * @param {string} newName
     * @returns {Promise<void>}
     */
    async renameModule(oldPath, newName) {
        await this.getModules();
        const result = this._findNodeByPath(oldPath);
        if (!result) throw new Error(`Path '${oldPath}' not found.`);
        if (!result.parent) throw new Error("Cannot rename the root directory.");

        const parentPath = result.parent.path;
        const newPath = (parentPath === '/' ? '' : parentPath) + '/' + newName;
        
        const nodeToRename = result.node;
        
        // 递归更新所有子节点的路径
        const updateChildrenPaths = (currentNode, oldBasePath, newBasePath) => {
            currentNode.path = currentNode.path.replace(oldBasePath, newBasePath);
            if (currentNode.children) {
                currentNode.children.forEach(child => updateChildrenPaths(child, oldBasePath, newBasePath));
            }
        };

        updateChildrenPaths(nodeToRename, oldPath, newPath);
        
        nodeToRename.meta.mtime = new Date().toISOString();
        result.parent.meta.mtime = new Date().toISOString();
        
        await this._save();
        
        // --- [核心改进] ---
        // 重命名也被视为一种更新
        this.eventManager.publish(getModuleEventName('node_updated', this.namespace), {
            updatedNode: nodeToRename
        });
    }
}
