/**
 * @file vfsCore/adapters/VFSPersistenceAdapter.js
 * @fileoverview VFSPersistenceAdapter - 让 VFSCore 实现 IPersistenceAdapter 接口
 */

import { IPersistenceAdapter } from '@itookit/common';

export class VFSPersistenceAdapter extends IPersistenceAdapter {
    /**
     * @param {import('../VFSCore').VFSCore} vfsCore
     * @param {string} nodeId - 当前文档的节点ID
     */
    constructor(vfsCore, nodeId) {
        super();
        this.vfs = vfsCore;
        this.nodeId = nodeId;
        this.metaPrefix = '_plugin_meta_';
    }
    
    /**
     * 存储数据到 VNode 的 meta 中
     */
    async setItem(key, value) {
        const vnode = await this.vfs.storage.loadVNode(this.nodeId);
        if (!vnode) {
            throw new Error(`Node ${this.nodeId} not found`);
        }
        
        // 存储在 meta 中
        if (!vnode.meta[this.metaPrefix]) {
            vnode.meta[this.metaPrefix] = {};
        }
        
        vnode.meta[this.metaPrefix][key] = value;
        vnode.markModified();
        
        await this.vfs.storage.saveVNode(vnode);
    }
    
    /**
     * 从 VNode 的 meta 中读取数据
     */
    async getItem(key) {
        const vnode = await this.vfs.storage.loadVNode(this.nodeId);
        if (!vnode) return null;
        
        const pluginData = vnode.meta[this.metaPrefix];
        return pluginData?.[key] ?? null;
    }
    
    /**
     * 删除数据
     */
    async removeItem(key) {
        const vnode = await this.vfs.storage.loadVNode(this.nodeId);
        if (!vnode) return;
        
        const pluginData = vnode.meta[this.metaPrefix];
        if (pluginData) {
            delete pluginData[key];
            vnode.markModified();
            await this.vfs.storage.saveVNode(vnode);
        }
    }
    
    /**
     * 清空所有插件数据
     */
    async clear() {
        const vnode = await this.vfs.storage.loadVNode(this.nodeId);
        if (!vnode) return;
        
        delete vnode.meta[this.metaPrefix];
        vnode.markModified();
        await this.vfs.storage.saveVNode(vnode);
    }
}
