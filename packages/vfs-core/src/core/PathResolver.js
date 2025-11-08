/**
 * @file vfsCore/core/PathResolver.js
 * @fileoverview PathResolver - 路径解析器
 */

export class PathResolver {
    constructor(vfs) {
        this.vfs = vfs;
    }
    
    /**
     * 解析路径，返回 VNode ID
     * @param {string} module
     * @param {string} path
     * @returns {Promise<string|null>}
     */
    async resolve(module, path) {
        // 标准化路径
        const normalizedPath = this.normalize(path);
        
        // 查询存储层
        return this.vfs.storage.getNodeIdByPath(module, normalizedPath);
    }
    
    /**
     * 解析父节点 ID
     * @param {string} module
     * @param {string} path
     * @returns {Promise<string|null>}
     */
    async resolveParent(module, path) {
        const parentPath = this.dirname(path);
        if (parentPath === path) return null; // 根节点
        
        return this.resolve(module, parentPath);
    }
    
    /**
     * 根据 VNode 计算完整路径
     * @param {import('./VNode.js').VNode} vnode
     * @returns {Promise<string>}
     */
    async resolvePath(vnode) {
        // 如果有缓存，直接返回
        if (vnode._path) {
            return vnode._path;
        }
        
        // 递归构建路径
        const segments = [];
        let current = vnode;
        
        while (current) {
            if (current.name) {
                segments.unshift(current.name);
            }
            
            if (!current.parent) break;
            
            current = await this.vfs.storage.loadVNode(current.parent);
        }
        
        const path = '/' + segments.join('/');
        
        // 缓存路径
        vnode._path = path;
        
        return path;
    }
    
    /**
     * 标准化路径
     * @param {string} path
     * @returns {string}
     */
    normalize(path) {
        if (!path) return '/';
        
        // 移除多余的斜杠
        let normalized = path.replace(/\/+/g, '/');
        
        // 确保以 / 开头
        if (!normalized.startsWith('/')) {
            normalized = '/' + normalized;
        }
        
        // 移除末尾的斜杠（除非是根目录）
        if (normalized !== '/' && normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }
        
        return normalized;
    }
    
    /**
     * 获取路径的目录部分
     * @param {string} path
     * @returns {string}
     */
    dirname(path) {
        const normalized = this.normalize(path);
        if (normalized === '/') return '/';
        
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash === 0) return '/';
        
        return normalized.substring(0, lastSlash);
    }
    
    /**
     * 获取路径的文件名部分
     * @param {string} path
     * @returns {string}
     */
    basename(path) {
        const normalized = this.normalize(path);
        if (normalized === '/') return '';
        
        const lastSlash = normalized.lastIndexOf('/');
        return normalized.substring(lastSlash + 1);
    }
    
    /**
     * 连接路径
     * @param {...string} segments
     * @returns {string}
     */
    join(...segments) {
        const joined = segments
            .filter(s => s)
            .join('/')
            .replace(/\/+/g, '/');
        
        return this.normalize(joined);
    }
    
    /**
     * 检查路径是否合法
     * @param {string} path
     * @returns {boolean}
     */
    isValid(path) {
        if (!path || typeof path !== 'string') return false;
        
        // 不允许包含特殊字符
        if (/[<>:"|?*]/.test(path)) return false;
        
        // 不允许包含 .. 或 .
        if (/\/\.\.?($|\/)/.test(path)) return false;
        
        return true;
    }
}
