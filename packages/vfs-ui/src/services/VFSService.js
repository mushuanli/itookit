/**
 * @file vfs-ui/services/VFSService.js
 * @description Acts as a bridge between UI actions and the vfs-core.
 * All dependencies are injected, making it a testable, decoupled service layer.
 */
import { ISessionService } from '@itookit/common';
import { parseFileInfo } from '../utils/parser.js';

/**
 * @implements {ISessionService}
 */
export class VFSService extends ISessionService {
    /**
     * @param {object} dependencies
     * @param {import('../stores/VFSStore.js').VFSStore} dependencies.store
     * @param {import('@itookit/vfs-core').VFSCore} dependencies.vfsCore
     * @param {string} dependencies.moduleName
     * @param {string} [dependencies.newFileContent='']
     */
    constructor({ store, vfsCore, moduleName, newFileContent = '' }) {
        super();
        if (!store || !vfsCore || !moduleName) {
            throw new Error("VFSService requires store, vfsCore, and moduleName.");
        }
        this.store = store;
        this.vfsCore = vfsCore;
        this.moduleName = moduleName;
        this.newFileContent = newFileContent;
    }

    // --- Data Loading & Transformation ---

    /**
     * Handles the initial module tree data loaded from vfs-core.
     * @param {import('@itookit/vfs-core').VNode[]} vnodeTree - Data from vfsCore.getTree().
     */
    async handleVFSCoreLoad(vnodeTree) {
        if (!vnodeTree || vnodeTree.length === 0) {
            this.store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items: [], tags: new Map() } });
            return;
        }
        // The getTree method in vfs-core should return a nested structure directly.
        // If it returns a flat list, a tree-building function is needed here.
        // Assuming getTree returns a tree as per common expectations.
        const items = this._vnodesToUIItems(vnodeTree, null);
        const tags = this._buildTagsMap(items);
        this.store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items, tags } });
    }

    /**
     * @private
     * @param {import('@itookit/vfs-core').VNode[]} nodes
     * @param {string | null} parentId
     * @returns {import('../types/types.js')._VFSNodeUI[]}
     */
    _vnodesToUIItems(nodes, parentId) {
        if (!nodes) return [];
        return nodes.map(node => this.vnodeToUIItem(node, parentId));
    }
    
    /**
     * @param {import('@itookit/vfs-core').VNode} node
     * @param {string | null} parentId
     * @returns {import('../types/types.js')._VFSNodeUI}
     */
    vnodeToUIItem(node, parentId) {
        const isDirectory = node.isDirectory();
        const parsedInfo = {};

        return {
            id: node.id,
            type: isDirectory ? 'directory' : 'file',
            version: "1.0",
            metadata: {
                title: node.name,
                tags: node.meta.tags || [],
                createdAt: node.meta.createdAt?.toISOString(),
                lastModified: node.meta.modifiedAt?.toISOString(),
                parentId: node.parent || parentId,
                moduleName: node.module,
                path: node.path || '', // FIX: Safely access path
                custom: node.meta || {},
            },
            content: isDirectory ? undefined : {
                format: node.contentType || 'text/plain',
                summary: node.meta.summary || parsedInfo.summary || '',
                searchableText: node.meta.searchableText || parsedInfo.searchableText || '',
                data: null,
            },
            headings: node.meta.headings || parsedInfo.headings || [],
            children: isDirectory ? this._vnodesToUIItems(node.children, node.id) : undefined, // FIX: Safely access children
        };
    }

    _buildTagsMap(items) {
        const tagsMap = new Map();
        const traverse = (itemList) => {
            for (const item of itemList) {
                if(item.metadata && item.metadata.tags){
                    const itemTags = item.metadata.tags || [];
                    for (const tagName of itemTags) {
                        if (!tagsMap.has(tagName)) {
                            tagsMap.set(tagName, { name: tagName, color: null, itemIds: new Set() });
                        }
                        tagsMap.get(tagName).itemIds.add(item.id);
                    }
                }
                if (item.children) traverse(item.children);
            }
        };
        traverse(items);
        return tagsMap;
    }

    /**
     * FIX [2]: Implement createSession to satisfy ISessionService interface.
     * This method acts as an alias for createFile.
     * @param {{ title?: string; content?: string; parentId?: string }} options
     * @returns {Promise<object>}
     */
    async createSession(options) {
        // FIX: Ensure 'content' property is passed, even if undefined
        return this.createFile({ ...options });
    }
    
    async createFile({ title = 'Untitled File', parentId = null, content = this.newFileContent }) {
        const path = this._buildPath(parentId, title);
        return this.vfsCore.createFile(this.moduleName, path, content);
    }

    async createDirectory({ title = 'New Directory', parentId = null }) {
        const path = this._buildPath(parentId, title);
        return this.vfsCore.createDirectory(this.moduleName, path);
    }

    async renameItem(nodeId, newTitle) {
        const nodeStat = await this.vfsCore.stat(nodeId);
        const parentNodeStat = nodeStat.parent ? await this.vfsCore.stat(nodeStat.parent) : null;
        const parentPath = parentNodeStat ? parentNodeStat.path : '/';
        const newPath = `${parentPath === '/' ? '' : parentPath}/${newTitle}`;
        return this.vfsCore.move(nodeId, newPath);
    }
    
    /**
     * @param {string} itemId
     * @param {Record<string, any>} metadataUpdates
     * @returns {Promise<void>}
     */
    async updateItemMetadata(itemId, metadataUpdates) {
        const nodeStat = await this.vfsCore.stat(itemId);
        const newMeta = { ...nodeStat.meta, ...metadataUpdates };
        await this.vfsCore.write(itemId, undefined, { meta: newMeta });
    }

    async deleteItems(nodeIds) {
        await Promise.all(nodeIds.map(id => this.vfsCore.unlink(id)));
    }

    async moveItems({ itemIds, targetId }) {
        const targetNodeStat = await this.vfsCore.stat(targetId);
        if (!targetNodeStat || targetNodeStat.type !== 'directory') throw new Error("Invalid move target: not a directory.");
        const targetPath = targetNodeStat.path;
        for (const id of itemIds) {
            const itemToMoveStat = await this.vfsCore.stat(id);
            // @ts-ignore
            const destinationPath = `${targetPath}/${itemToMoveStat.name}`;
            await this.vfsCore.move(id, destinationPath);
        }
    }

    async updateMultipleItemsTags({ itemIds, newTags }) {
        // This would ideally be a batch operation in vfs-core
        for (const id of itemIds) {
            await this.updateItemMetadata(id, { tags: newTags });
        }
    }

    _buildPath(parentId, title) {
        if (!parentId) return `/${title}`;
        const parentItem = this.findItemById(parentId);
        if (!parentItem) return `/${title}`; // Fallback to root
        // This assumes UI items have a path; in reality, we'd query vfs-core for the parent path
        const parentPath = parentItem.metadata?.path || '/'; 
        return `${parentPath === '/' ? '' : parentPath}/${title}`;
    }

    /**
     * @param {string} nodeId
     * @returns {import('../types/types.js')._VFSNodeUI | undefined}
     */
    findItemById(nodeId) {
        const find = (items, id) => {
            for (const item of items) {
                if (item.id === id) return item;
                if (item.children) {
                    const found = find(item.children, id);
                    if (found) return found;
                }
            }
            return undefined;
        };
        return find(this.store.getState().items, nodeId);
    }

    async getAllFolders() {
        const folders = [];
        const traverse = (items) => {
            for (const item of items) {
                if (item.type === 'directory') {
                    folders.push(item);
                    if (item.children) traverse(item.children);
                }
            }
        };
        traverse(this.store.getState().items);
        return folders;
    }

    async getAllFiles() {
        const files = [];
        const traverse = (items) => {
            for (const item of items) {
                if (item.type === 'file') files.push(item);
                if (item.children) traverse(item.children);
            }
        };
        traverse(this.store.getState().items);
        return files;
    }

    getActiveSession() {
        const state = this.store.getState();
        return state.activeId ? this.findItemById(state.activeId) : undefined;
    }

    selectSession(nodeId) {
        this.store.dispatch({ type: 'SESSION_SELECT', payload: { sessionId: nodeId } });
    }
}
