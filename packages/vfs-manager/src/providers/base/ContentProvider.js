/**
 * @file vfsManager/providers/base/ContentProvider.js
 * @fileoverview ContentProvider - 内容提供者基类
 * 类比 Linux 的 file_operations
 */

export class ContentProvider {
    /**
     * @param {string} name - Provider 名称
     * @param {object} [options={}]
     * @param {number} [options.priority=0] - 执行优先级（数字越大优先级越高）
     * @param {string[]} [options.capabilities=[]] - 支持的能力
     */
    constructor(name, options = {}) {
        if (!name) {
            throw new Error('Provider name is required');
        }
        
        this.name = name;
        this.priority = options.priority || 0;
        this.capabilities = options.capabilities || [];
        this.enabled = true;
    }
    
    /**
     * 检查是否可以处理该节点
     * @param {import('../../core/VNode.js').VNode} vnode
     * @returns {boolean}
     */
    canHandle(vnode) {
        return vnode.providers.includes(this.name);
    }
    
    /**
     * 读取内容
     * @abstract
     * @param {import('../../core/VNode.js').VNode} vnode
     * @param {object} [options={}]
     * @returns {Promise<{content: string, metadata: object}>}
     */
    async read(vnode, options = {}) {
        throw new Error(`${this.name}: read() must be implemented`);
    }
    
    /**
     * 写入内容
     * @abstract
     * @param {import('../../core/VNode.js').VNode} vnode
     * @param {string} content
     * @param {import('../../utils/Transaction.js').Transaction} transaction
     * @returns {Promise<{updatedContent: string, derivedData: object}>}
     */
    async write(vnode, content, transaction) {
        throw new Error(`${this.name}: write() must be implemented`);
    }
    
    /**
     * 验证内容
     * @param {import('../../core/VNode.js').VNode} vnode
     * @param {string} content
     * @returns {Promise<{valid: boolean, errors: string[]}>}
     */
    async validate(vnode, content) {
        return { valid: true, errors: [] };
    }
    
    /**
     * 清理派生数据
     * @param {import('../../core/VNode.js').VNode} vnode
     * @param {import('../../utils/Transaction.js').Transaction} transaction
     * @returns {Promise<void>}
     */
    async cleanup(vnode, transaction) {
        // 默认不需要清理
    }
    
    /**
     * 获取派生数据统计
     * @param {import('../../core/VNode.js').VNode} vnode
     * @returns {Promise<object>}
     */
    async getStats(vnode) {
        return {};
    }
    
    /**
     * 处理节点移动
     * @param {import('../../core/VNode.js').VNode} vnode
     * @param {string} oldPath
     * @param {string} newPath
     * @param {import('../../utils/Transaction.js').Transaction} transaction
     * @returns {Promise<void>}
     */
    async onMove(vnode, oldPath, newPath, transaction) {
        // 默认不需要处理
    }
    
    /**
     * 处理节点复制
     * @param {import('../../core/VNode.js').VNode} sourceVNode
     * @param {import('../../core/VNode.js').VNode} targetVNode
     * @param {import('../../utils/Transaction.js').Transaction} transaction
     * @returns {Promise<void>}
     */
    async onCopy(sourceVNode, targetVNode, transaction) {
        // 默认不需要处理
    }
    
    /**
     * 生命周期钩子：Provider 启用
     */
    async onEnable() {
        this.enabled = true;
    }
    
    /**
     * 生命周期钩子：Provider 禁用
     */
    async onDisable() {
        this.enabled = false;
    }
    
    /**
     * 检查是否支持某个能力
     * @param {string} capability
     * @returns {boolean}
     */
    hasCapability(capability) {
        return this.capabilities.includes(capability);
    }
}
