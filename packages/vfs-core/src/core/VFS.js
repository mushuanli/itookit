/**
 * @file vfsCore/core/VFS.js
 * @fileoverview VFS - 虚拟文件系统核心
 */

/**
 * @typedef {Object} CreateNodeOptions
 * @property {'file'|'directory'|'symlink'} [type='file'] - 节点类型
 * @property {string} module - 模块名称
 * @property {string} path - 节点路径
 * @property {string} [contentType='plain'] - 内容类型
 * @property {string} [content=''] - 初始内容
 * @property {object} [meta={}] - 元数据
 * @property {string|null} [parent=null] - 父节点ID
 */

/**
 * @typedef {Object} ReadResult
 * @property {string|null} content - 内容
 * @property {object} metadata - 元数据
 */

/**
 * @typedef {Object} UnlinkResult
 * @property {string} removedNodeId - 被删除的节点ID
 * @property {string[]} allRemovedIds - 所有被删除的节点ID列表
 */

import { VNode } from './VNode.js';
import { PathResolver } from './PathResolver.js';
import { 
    VFSError, 
    VNodeNotFoundError, 
    PathExistsError,
    NotDirectoryError,
    ValidationError 
} from './VFSError.js';

export class VFS {
    /**
     * @param {import('../storage/VFSStorage.js').VFSStorage} storage
     * @param {import('../registry/ProviderRegistry.js').ProviderRegistry} registry
     * @param {import('../utils/EventBus.js').EventBus} eventBus
     */
    constructor(storage, registry, eventBus) {
        this.storage = storage;
        this.registry = registry;
        this.events = eventBus;
        this.pathResolver = new PathResolver(this);
    }
    
    /**
     * 创建节点
     * @param {CreateNodeOptions} options
     * @returns {Promise<VNode>}
     */
    async createNode(options) {
        const {
            type = 'file',
            module,
            path,
            contentType = 'plain',
            content = '',
            meta = {},
            parent = null
        } = options;
        
        if (!module) {
            throw new ValidationError('Module name is required');
        }
        
        if (!path) {
            throw new ValidationError('Path is required');
        }
        
        // 验证路径
        if (!this.pathResolver.isValid(path)) {
            throw new ValidationError(`Invalid path: ${path}`);
        }
        
        // 检查路径是否已存在
        const existingId = await this.storage.getNodeIdByPath(module, path);
        if (existingId) {
            throw new PathExistsError(path);
        }
        
        // 解析父节点
        let parentId = parent;
        if (!parentId && path !== '/') {
            parentId = await this.pathResolver.resolveParent(module, path);
        }
        
        // 创建 VNode
        const vnode = new VNode({
            type,
            module,
            name: this.pathResolver.basename(path),
            parent: parentId,
            contentType,
            providers: this.registry.getDefaultProviders(contentType),
            meta
        });
        
        // 开始事务
        const tx = await this.storage.beginTransaction();
        
        try {
            // 处理内容
            let processedContent = content;
            const allDerivedData = {};
            
            if (type === 'file' && content) {
                const providers = this.registry.getProvidersForNode(vnode);
                
                for (const provider of providers) {
                    // 验证
                    const validation = await provider.validate(vnode, processedContent);
                    if (!validation.valid) {
                        throw new ValidationError(
                            `Provider '${provider.name}' validation failed`,
                            validation.errors
                        );
                    }
                    
                    // 写入
                    const result = await provider.write(vnode, processedContent, tx);
                    processedContent = result.updatedContent;
                    Object.assign(allDerivedData, result.derivedData);
                }
            }
            
            // 保存内容
            if (type === 'file') {
                vnode.contentRef = await this.storage.saveContent(
                    vnode.id,
                    processedContent,
                    tx
                );
                vnode.meta.size = processedContent.length;
            }
            
            // 保存 VNode
            await this.storage.saveVNode(vnode, tx);
            
            // 提交事务
            await tx.commit();
            
            // 发布事件
            this.events.emit('vnode:created', {
                vnode,
                derivedData: allDerivedData
            });
            
            console.log(`[VFS] Created ${type}: ${path} (${vnode.id})`);
            
            return vnode;
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }
    
    /**
     * 读取节点内容
     * @param {string|VNode} vnodeOrId
     * @param {object} [options={}]
     * @returns {Promise<ReadResult>}
     */
    async read(vnodeOrId, options = {}) {
        const vnode = await this._resolveVNode(vnodeOrId);
        if (!vnode) {
            throw new VNodeNotFoundError(vnodeOrId);
        }
        
        // 目录没有内容
        if (vnode.isDirectory()) {
            return {
                content: null,
                metadata: {
                    type: 'directory',
                    ...vnode.getStat()
                }
            };
        }
        
        // 更新访问时间
        vnode.touch();
        await this.storage.saveVNode(vnode);
        
        // 从存储读取原始内容
        let content = await this.storage.loadContent(vnode.contentRef);
        let metadata = vnode.getStat();
        
        // 通过 providers 增强
        const providers = this.registry.getProvidersForNode(vnode);
        
        for (const provider of providers) {
            const result = await provider.read(vnode, { 
                ...options, 
                rawContent: content 
            });
            
            if (result.content !== null) {
                content = result.content;
            }
            
            Object.assign(metadata, result.metadata);
        }
        
        return { content, metadata };
    }
    
    /**
     * 写入节点内容
     * @param {string|VNode} vnodeOrId
     * @param {string} content
     * @param {object} [options={}]
     * @returns {Promise<VNode>}
     */
    async write(vnodeOrId, content, options = {}) {
        const vnode = await this._resolveVNode(vnodeOrId);
        if (!vnode) {
            throw new VNodeNotFoundError(vnodeOrId);
        }
        
        if (vnode.isDirectory()) {
            throw new NotDirectoryError(`Cannot write to directory: ${vnode.id}`);
        }
        
        const tx = await this.storage.beginTransaction();
        
        try {
            // 按优先级通过所有 providers 处理
            let processedContent = content;
            const allDerivedData = {};
            
            const providers = this.registry.getProvidersForNode(vnode);
            
            for (const provider of providers) {
                // 验证
                const validation = await provider.validate(vnode, processedContent);
                if (!validation.valid) {
                    throw new ValidationError(
                        `Provider '${provider.name}' validation failed`,
                        validation.errors
                    );
                }
                
                // 写入
                const result = await provider.write(vnode, processedContent, tx);
                processedContent = result.updatedContent;
                Object.assign(allDerivedData, result.derivedData);
            }
            
            // 更新内容
            await this.storage.updateContent(
                vnode.contentRef,
                processedContent,
                tx
            );
            
            // 更新元数据
            vnode.markModified();
            vnode.meta.size = processedContent.length;
            vnode.invalidateCache();
            
            await this.storage.saveVNode(vnode, tx);
            
            // 提交事务
            await tx.commit();
            
            // 发布事件
            this.events.emit('vnode:updated', {
                vnode,
                derivedData: allDerivedData
            });
            
            console.log(`[VFS] Updated: ${vnode.id}`);
            
            return vnode;
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }
    
    /**
     * 删除节点
     * @param {string|VNode} vnodeOrId
     * @param {object} [options={}]
     * @param {boolean} [options.recursive=false] - 是否递归删除
     * @returns {Promise<UnlinkResult>}
     */
    async unlink(vnodeOrId, options = {}) {
        const vnode = await this._resolveVNode(vnodeOrId);
        
        // 修正：确保 removedNodeId 始终是字符串
        if (!vnode) {
            const nodeIdStr = typeof vnodeOrId === 'string' 
                ? vnodeOrId 
                : (vnodeOrId && vnodeOrId.id ? vnodeOrId.id : 'unknown');
            return { 
                removedNodeId: nodeIdStr, 
                allRemovedIds: [] 
            };
        }
        
        const tx = await this.storage.beginTransaction();
        
        try {
            // 收集所有要删除的节点
            const nodesToDelete = vnode.isDirectory() && !options.recursive
                ? [vnode]
                : await this._collectDescendants(vnode);
            
            const nodeIdsToDelete = nodesToDelete.map(n => n.id);
            
            // 清理所有派生数据
            for (const node of nodesToDelete) {
                const providers = this.registry.getProvidersForNode(node);
                
                for (const provider of providers) {
                    await provider.cleanup(node, tx);
                }
                
                // 删除内容
                if (node.contentRef) {
                    await this.storage.deleteContent(node.contentRef, tx);
                }
                
                // 删除 VNode
                await this.storage.deleteVNode(node.id, tx);
            }
            
            // 提交事务
            await tx.commit();
            
            // 发布事件
            this.events.emit('vnode:deleted', {
                vnode,
                deletedIds: nodeIdsToDelete
            });
            
            console.log(`[VFS] Deleted: ${vnode.id} (${nodeIdsToDelete.length} nodes)`);
            
            return {
                removedNodeId: vnode.id,
                allRemovedIds: nodeIdsToDelete
            };
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }
    
    /**
     * 移动节点
     * @param {string|VNode} vnodeOrId
     * @param {string} newPath
     * @returns {Promise<VNode>}
     */
    async move(vnodeOrId, newPath) {
        const vnode = await this._resolveVNode(vnodeOrId);
        if (!vnode) {
            throw new VNodeNotFoundError(vnodeOrId);
        }
        
        const oldPath = await this.pathResolver.resolvePath(vnode);
        
        // 验证新路径
        if (!this.pathResolver.isValid(newPath)) {
            throw new ValidationError(`Invalid path: ${newPath}`);
        }
        
        // 检查目标路径是否已存在
        const existingId = await this.storage.getNodeIdByPath(vnode.module, newPath);
        if (existingId && existingId !== vnode.id) {
            throw new PathExistsError(newPath);
        }
        
        const tx = await this.storage.beginTransaction();
        
        try {
            // 更新节点信息
            vnode.name = this.pathResolver.basename(newPath);
            vnode.parent = await this.pathResolver.resolveParent(vnode.module, newPath);
            vnode.markModified();
            vnode.invalidateCache();
            
            await this.storage.saveVNode(vnode, tx);
            
            // 通知 providers
            const providers = this.registry.getProvidersForNode(vnode);
            for (const provider of providers) {
                await provider.onMove(vnode, oldPath, newPath, tx);
            }
            
            await tx.commit();
            
            this.events.emit('vnode:moved', {
                vnode,
                oldPath,
                newPath
            });
            
            console.log(`[VFS] Moved: ${oldPath} -> ${newPath}`);
            
            return vnode;
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }
    
    /**
     * 复制节点
     * @param {string|VNode} sourceId
     * @param {string} targetPath
     * @returns {Promise<VNode>}
     */
    async copy(sourceId, targetPath) {
        const sourceVNode = await this._resolveVNode(sourceId);
        if (!sourceVNode) {
            throw new VNodeNotFoundError(sourceId);
        }
        
        // 读取源内容
        const { content } = await this.read(sourceVNode);
        
        // 创建新节点
        const targetVNode = await this.createNode({
            type: sourceVNode.type,
            module: sourceVNode.module,
            path: targetPath,
            contentType: sourceVNode.contentType,
            content,
            meta: { ...sourceVNode.meta }
        });
        
        // 通知 providers 处理复制
        const tx = await this.storage.beginTransaction();
        
        try {
            const providers = this.registry.getProvidersForNode(sourceVNode);
            for (const provider of providers) {
                await provider.onCopy(sourceVNode, targetVNode, tx);
            }
            
            await tx.commit();
            
            this.events.emit('vnode:copied', {
                sourceVNode,
                targetVNode
            });
            
            return targetVNode;
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }
    
    /**
     * 读取目录
     * @param {string|VNode} vnodeOrId
     * @param {object} [options={}]
     * @returns {Promise<VNode[]>}
     */
    async readdir(vnodeOrId, options = {}) {
        const vnode = await this._resolveVNode(vnodeOrId);
        if (!vnode) {
            throw new VNodeNotFoundError(vnodeOrId);
        }
        
        if (!vnode.isDirectory()) {
            throw new NotDirectoryError(vnode.id);
        }
        
        const children = await this.storage.getChildren(vnode.id);
        
        if (options.recursive) {
            return this._buildTree(children);
        }
        
        return children;
    }
    
    /**
     * 获取节点统计信息
     * @param {string|VNode} vnodeOrId
     * @returns {Promise<object>}
     */
    async stat(vnodeOrId) {
        const vnode = await this._resolveVNode(vnodeOrId);
        if (!vnode) {
            throw new VNodeNotFoundError(vnodeOrId);
        }
        
        const stat = vnode.getStat();
        
        // 获取 provider 统计
        const providers = this.registry.getProvidersForNode(vnode);
        const providerStats = {};
        
        for (const provider of providers) {
            providerStats[provider.name] = await provider.getStats(vnode);
        }
        
        return {
            ...stat,
            path: await this.pathResolver.resolvePath(vnode),
            providers: providerStats
        };
    }
    
    // ========== 私有方法 ==========
    
    /**
     * 解析 VNode
     * @private
     * @param {string|VNode} vnodeOrId
     * @returns {Promise<VNode|null>}
     */
    async _resolveVNode(vnodeOrId) {
        if (vnodeOrId instanceof VNode) {
            return vnodeOrId;
        }
        
        if (typeof vnodeOrId === 'string') {
            return this.storage.loadVNode(vnodeOrId);
        }
        
        return null;
    }
    
    /**
     * 收集节点及其所有后代
     */
    async _collectDescendants(vnode) {
        const result = [vnode];
        
        if (vnode.isDirectory()) {
            const children = await this.storage.getChildren(vnode.id);
            
            for (const child of children) {
                const descendants = await this._collectDescendants(child);
                result.push(...descendants);
            }
        }
        
        return result;
    }
    
    /**
     * 构建树形结构
     */
    async _buildTree(nodes) {
        const tree = [];
        
        for (const node of nodes) {
            if (node.isDirectory()) {
                const children = await this.storage.getChildren(node.id);
                node.children = await this._buildTree(children);
            }
            tree.push(node);
        }
        
        return tree;
    }
}
