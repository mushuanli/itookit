/**
 * @file vfsManager/utils/EventBus.js
 * @fileoverview EventBus - 事件总线
 */

export class EventBus {
    constructor() {
        /** @type {Map<string, Set<Function>>} */
        this.listeners = new Map();
    }
    
    /**
     * 订阅事件
     * @param {string} event
     * @param {Function} callback
     * @returns {Function} 取消订阅函数
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        
        this.listeners.get(event).add(callback);
        
        // 返回取消订阅函数
        return () => this.off(event, callback);
    }
    
    /**
     * 订阅一次性事件
     * @param {string} event
     * @param {Function} callback
     * @returns {Function} 取消订阅函数
     */
    once(event, callback) {
        const wrapper = (...args) => {
            callback(...args);
            this.off(event, wrapper);
        };
        
        return this.on(event, wrapper);
    }
    
    /**
     * 取消订阅
     * @param {string} event
     * @param {Function} callback
     */
    off(event, callback) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
                this.listeners.delete(event);
            }
        }
    }
    
    /**
     * 发布事件
     * @param {string} event
     * @param {*} data
     */
    emit(event, data) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`[EventBus] Error in listener for '${event}':`, error);
                }
            });
        }
    }
    
    /**
     * 清除所有监听器
     * @param {string} [event] - 如果指定，只清除该事件的监听器
     */
    clear(event) {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }
    
    /**
     * 获取事件的监听器数量
     * @param {string} event
     * @returns {number}
     */
    listenerCount(event) {
        return this.listeners.get(event)?.size || 0;
    }
    
    /**
     * 获取所有事件名称
     * @returns {string[]}
     */
    eventNames() {
        return Array.from(this.listeners.keys());
    }
}
