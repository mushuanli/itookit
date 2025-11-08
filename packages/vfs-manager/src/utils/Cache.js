/**
 * @fileoverview Cache - LRU 缓存实现
 */

export class Cache {
    /**
     * @param {number} [maxSize=1000] - 最大缓存条目数
     */
    constructor(maxSize = 1000) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    
    /**
     * 获取缓存值
     * @param {string} key
     * @returns {*}
     */
    get(key) {
        if (!this.cache.has(key)) {
            return undefined;
        }
        
        // LRU: 将访问的项移到最后
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        
        return value;
    }
    
    /**
     * 设置缓存值
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
        // 如果已存在，先删除
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        
        // 如果超过容量，删除最旧的项
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        
        this.cache.set(key, value);
    }
    
    /**
     * 检查键是否存在
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        return this.cache.has(key);
    }
    
    /**
     * 删除缓存项
     * @param {string} key
     */
    delete(key) {
        this.cache.delete(key);
    }
    
    /**
     * 使缓存失效
     * @param {string} key
     */
    invalidate(key) {
        this.delete(key);
    }
    
    /**
     * 清空缓存
     */
    clear() {
        this.cache.clear();
    }
    
    /**
     * 获取缓存大小
     * @returns {number}
     */
    size() {
        return this.cache.size;
    }
    
    /**
     * 获取所有键
     * @returns {string[]}
     */
    keys() {
        return Array.from(this.cache.keys());
    }
}
