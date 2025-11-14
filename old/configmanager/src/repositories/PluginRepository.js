// #configManager/repositories/PluginRepository.js

/**
 * @fileoverview 负责 Plugin (插件) 信息的持久化和管理。
 */
import { STORES } from '../constants.js';

export class PluginRepository {
    /**
     * @param {import('../db.js').Database} db - 数据库实例
     */
    constructor(db) {
        this.db = db;
    }

    /**
     * 添加或更新一个插件。
     * @param {object} pluginData - 插件对象
     * @returns {Promise<string>} 插件的 ID
     */
    async savePlugin(pluginData) {
        const tx = await this.db.getTransaction(STORES.PLUGINS, 'readwrite');
        const store = tx.objectStore(STORES.PLUGINS);
        return new Promise((resolve, reject) => {
            const request = store.put(pluginData);
            // FIX: Cast result to string to match the JSDoc return type.
            request.onsuccess = () => resolve(String(request.result));
            // FIX: Cast event.target to access the 'error' property.
            request.onerror = (e) => reject((/** @type {IDBRequest} */ (e.target)).error);
        });
    }

    /**
     * 根据 ID 获取插件信息。
     * @param {string} pluginId
     * @returns {Promise<object|undefined>}
     */
    async getPlugin(pluginId) {
        const tx = await this.db.getTransaction(STORES.PLUGINS, 'readonly');
        const store = tx.objectStore(STORES.PLUGINS);
        return new Promise((resolve, reject) => {
            const request = store.get(pluginId);
            // FIX: Cast event.target to access the 'result' property.
            request.onsuccess = e => resolve((/** @type {IDBRequest} */ (e.target)).result);
            // FIX: Cast event.target to access the 'error' property.
            request.onerror = e => reject((/** @type {IDBRequest} */ (e.target)).error);
        });
    }

    /**
     * 获取所有已安装的插件。
     * @returns {Promise<object[]>}
     */
    async getAllPlugins() {
        const tx = await this.db.getTransaction(STORES.PLUGINS, 'readonly');
        const store = tx.objectStore(STORES.PLUGINS);
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            // FIX: Cast event.target to access the 'result' property.
            request.onsuccess = e => resolve((/** @type {IDBRequest} */ (e.target)).result);
            // FIX: Cast event.target to access the 'error' property.
            request.onerror = e => reject((/** @type {IDBRequest} */ (e.target)).error);
        });
    }

    /**
     * 获取所有已启用的插件。
     * @returns {Promise<object[]>}
     */
    async getEnabledPlugins() {
        const allPlugins = await this.getAllPlugins();
        return allPlugins.filter(p => p.enabled);
    }

    /**
     * 更新插件配置或状态。
     * @param {string} pluginId
     * @param {object} updates - 要更新的字段，例如 { enabled: true, config: {...} }
     * @returns {Promise<object>} 更新后的插件对象
     */
    async updatePlugin(pluginId, updates) {
        const tx = await this.db.getTransaction(STORES.PLUGINS, 'readwrite');
        const store = tx.objectStore(STORES.PLUGINS);
        const plugin = await new Promise((resolve, reject) => {
             const request = store.get(pluginId);
             // FIX: Cast event.target to access the 'result' property.
             request.onsuccess = e => resolve((/** @type {IDBRequest} */ (e.target)).result);
             // FIX: Cast event.target to access the 'error' property.
             request.onerror = e => reject((/** @type {IDBRequest} */ (e.target)).error);
        });
        
        if (!plugin) throw new Error(`Plugin with id ${pluginId} not found.`);

        const updatedPlugin = { ...plugin, ...updates };
        await new Promise((resolve, reject) => {
            const request = store.put(updatedPlugin);
            request.onsuccess = resolve;
            // FIX: Cast event.target to access the 'error' property.
            request.onerror = e => reject((/** @type {IDBRequest} */ (e.target)).error);
        });
        return updatedPlugin;
    }

    /**
     * 删除一个插件。
     * @param {string} pluginId
     * @returns {Promise<void>}
     */
    async deletePlugin(pluginId) {
        const tx = await this.db.getTransaction(STORES.PLUGINS, 'readwrite');
        const store = tx.objectStore(STORES.PLUGINS);
        await new Promise((resolve, reject) => {
            const request = store.delete(pluginId);
            request.onsuccess = resolve;
            // FIX: Cast event.target to access the 'error' property.
            request.onerror = (e) => reject((/** @type {IDBRequest} */ (e.target)).error);
        });
    }
}
