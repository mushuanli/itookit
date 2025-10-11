// #config/adapters/LocalStorageAdapter.js

/**
 * @class LocalStorageAdapter
 * @description 使用浏览器 localStorage 实现数据持久化的适配器。
 * @implements {IPersistenceAdapter}
 */
export class LocalStorageAdapter {
    constructor(options = {}) {
        this.prefix = options.prefix || 'app_';
    }

    _getKey(key) {
        return `${this.prefix}${key}`;
    }

    async setItem(key, value) {
        try {
            const serializedValue = JSON.stringify(value);
            localStorage.setItem(this._getKey(key), serializedValue);
        } catch (error) {
            console.error(`Failed to save item '${key}' to localStorage:`, error);
            throw error;
        }
    }

    async getItem(key) {
        try {
            const serializedValue = localStorage.getItem(this._getKey(key));
            return serializedValue ? JSON.parse(serializedValue) : null;
        } catch (error) {
            console.error(`Failed to retrieve item '${key}' from localStorage:`, error);
            return null;
        }
    }

    async removeItem(key) {
        localStorage.removeItem(this._getKey(key));
    }

    async clear() {
        // 注意：这会清除所有以 prefix 开头的键，需要谨慎使用
        Object.keys(localStorage)
            .filter(key => key.startsWith(this.prefix))
            .forEach(key => localStorage.removeItem(key));
    }
}
