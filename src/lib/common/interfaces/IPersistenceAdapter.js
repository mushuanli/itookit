// 文件: #common/interfaces/IPersistenceAdapter.js

/**
 * @file IPersistenceAdapter.js - 定义了所有数据持久化适配器必须实现的接口。
 * @description
 * 任何希望与 ConfigManager 集成的存储后端（如 LocalStorage, IndexedDB, 或远程API）
 * 都必须实现这个接口。它提供了一个统一的、基于键值对的异步存储API。
 * @interface
 */
export class IPersistenceAdapter {
    /**
     * @protected
     * 构造函数，防止接口被直接实例化。
     */
    constructor() {
        if (this.constructor === IPersistenceAdapter) {
            throw new Error("IPersistenceAdapter 是一个接口，不能被直接实例化。");
        }
    }

    /**
     * 根据指定的键（key）存储一个值（value）。
     * 值在存储前通常会被序列化（例如，转换为JSON字符串）。
     * @param {string} key - 用于存储和检索数据的唯一键。
     * @param {any} value - 需要被存储的数据。可以是任何可被JSON序列化的类型。
     * @returns {Promise<void>} 操作完成时解析的 Promise。
     */
    async setItem(key, value) {
        throw new Error("适配器必须实现 'setItem' 方法。");
    }

    /**
     * 根据指定的键（key）检索一个值。
     * 如果找不到对应的键，应返回 null。
     * @param {string} key - 要检索的数据的键。
     * @returns {Promise<any|null>} 一个解析为存储的数据的 Promise，如果键不存在则解析为 null。
     */
    async getItem(key) {
        throw new Error("适配器必须实现 'getItem' 方法。");
    }

    /**
     * 根据指定的键（key）移除一个存储项。
     * @param {string} key - 要移除的数据的键。
     * @returns {Promise<void>} 操作完成时解析的 Promise。
     */
    async removeItem(key) {
        throw new Error("适配器必须实现 'removeItem' 方法。");
    }

    /**
     * 清除由此适配器管理的所有数据。
     * 注意：实现时应考虑范围，例如只清除特定前缀下的键，以避免影响其他应用。
     * @returns {Promise<void>} 操作完成时解析的 Promise。
     */
    async clear() {
        throw new Error("适配器必须实现 'clear' 方法。");
    }
}
