/**
 * @file vfsCore/core/VNode.js
 * @fileoverview VNode - 虚拟文件系统节点
 * 类比 Linux inode，存储文件元数据和内容引用
 */

import { v4 as uuidv4 } from 'uuid';

export class VNode {
    /**
     * @param {object} options
     * @param {string} [options.id] - 唯一标识符（可选，自动生成）
     * @param {'file'|'directory'|'symlink'} options.type - 节点类型
     * @param {string} options.module - 所属模块（命名空间）
     * @param {string} options.name - 节点名称
     * @param {string|null} [options.parent] - 父节点 ID
     * @param {string} [options.contentType='plain'] - 内容类型
     * @param {string[]} [options.providers=[]] - 关联的 providers
     * @param {object} [options.meta={}] - 元数据
     * @param {string|null} [options.contentRef=null] - 内容存储引用
     */
    constructor(options) {
        // 基础属性
        this.id = options.id || `${options.module}-${uuidv4()}`;
        this.type = options.type;
        this.module = options.module;
        
        // 路径信息
        this.name = options.name;
        this.parent = options.parent || null;
        
        // 内容类型
        this.contentType = options.contentType || 'plain';
        this.providers = options.providers || [];
        
        // 元数据
        const now = new Date();
        this.meta = {
            size: 0,
            createdAt: now,
            modifiedAt: now,
            accessedAt: now,
            permissions: '0644',
            owner: null,
            tags: [],
            ...options.meta
        };
        
        // 内容引用（不直接存储内容）
        this.contentRef = options.contentRef || null;
        
        // 【修改】移除了 this._path 的初始化。
        // 公开的 'path' 属性将是 undefined 直到被计算。
        /**
         * @type {string | undefined}
         * @description 运行时计算的完整路径
         */
        this.path = undefined;
        /**
         * @type {VNode[] | undefined}
         * @description 运行时构建的子节点列表（仅目录节点）
         */
        this.children = undefined;
    }
    
    /**
     * 检查是否是目录
     */
    isDirectory() {
        return this.type === 'directory';
    }
    
    /**
     * 检查是否是文件
     */
    isFile() {
        return this.type === 'file';
    }
    
    /**
     * 检查是否是符号链接
     */
    isSymlink() {
        return this.type === 'symlink';
    }
    
    /**
     * 使缓存失效
     */
    invalidateCache() {
        this._cached = false;
        this._content = null;
        
        // 【修改】现在我们重置公开的 path 属性
        this.path = undefined;
    }
    
    /**
     * 更新访问时间
     */
    touch() {
        this.meta.accessedAt = new Date();
    }
    
    /**
     * 更新修改时间
     */
    markModified() {
        this.meta.modifiedAt = new Date();
    }
    
    /**
     * 序列化为普通对象（用于存储）
     */
    toJSON() {
        return {
            id: this.id,
            type: this.type,
            module: this.module,
            name: this.name,
            parent: this.parent,
            contentType: this.contentType,
            providers: this.providers,
            meta: this.meta,
            contentRef: this.contentRef
        };
    }
    
    /**
     * 从普通对象反序列化
     */
    static fromJSON(data) {
        return new VNode(data);
    }
    
    /**
     * 克隆节点
     */
    clone() {
        return VNode.fromJSON(this.toJSON());
    }
    
    /**
     * 获取节点信息摘要
     * @returns {import('../index.d.ts').VNodeStat}
     */
    getStat() {
        return {
            id: this.id,
            type: this.type,
            name: this.name,
            size: this.meta.size,
            createdAt: this.meta.createdAt,
            modifiedAt: this.meta.modifiedAt,
            accessedAt: this.meta.accessedAt,
            permissions: this.meta.permissions,
            contentType: this.contentType,
            
            // <<< FIX #2: Add missing properties to match VNodeStat type
            parent: this.parent,
            meta: this.meta,
            // path is populated at runtime by the resolver. Provide a default value
            // to satisfy the type. The correct path will overwrite this in VFS.stat().
            path: this.path || '', 
        };
    }
}
