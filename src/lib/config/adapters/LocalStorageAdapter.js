// #config/adapters/LocalStorageAdapter.js

import { IPersistenceAdapter } from '../../common/interfaces/IPersistenceAdapter.js';

/**
 * @class LocalStorageAdapter
 * @description 使用浏览器 localStorage 实现数据持久化的适配器。
 * @implements {IPersistenceAdapter}
 */
export class LocalStorageAdapter extends IPersistenceAdapter {
    /**
     * @param {object} [options]
     * @param {string} [options.prefix='app_'] - 添加到所有键的前缀，用于隔离数据。
     */
    constructor(options = {}) {
        super();
        this.prefix = options.prefix || 'app_';
    }

    /**
     * 获取带有前缀的完整存储键。
     * @private
     * @param {string} key - 原始键。
     * @returns {string} - 加上前缀后的键。
     */
    _getKey(key) {
        return `${this.prefix}${key}`;
    }

    /**
     * @override
     */
    async setItem(key, value) {
        try {
            const serializedValue = JSON.stringify(value);
            localStorage.setItem(this._getKey(key), serializedValue);
        } catch (error) {
            console.error(`将键 '${key}' 保存到 localStorage 失败:`, error);
            // 向上抛出错误，以便调用方可以处理它
            throw error;
        }
    }

    /**
     * @override
     */
    async getItem(key) {
        try {
            const serializedValue = localStorage.getItem(this._getKey(key));
            return serializedValue ? JSON.parse(serializedValue) : null;
        } catch (error) {
            console.error(`从 localStorage 检索键 '${key}' 失败:`, error);
            // 在解析失败等情况下返回 null，提供一个安全的回退
            return null;
        }
    }

    /**
     * @override
     */
    async removeItem(key) {
        localStorage.removeItem(this._getKey(key));
    }

    /**
     * @override
     */
    async clear() {
        // 遍历 localStorage 的所有键
        Object.keys(localStorage)
            // 只筛选出与此前缀匹配的键
            .filter(key => key.startsWith(this.prefix))
            // 逐个移除
            .forEach(key => localStorage.removeItem(key));
    }
}
