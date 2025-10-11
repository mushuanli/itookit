// #config/EventManager.js

/**
 * @class EventManager
 * @description 一个简单的发布/订阅事件管理器，用于在应用程序的不同部分之间解耦通信。
 */
export class EventManager {
    constructor() {
        this.listeners = new Map();
    }

    /**
     * 订阅一个事件。
     * @param {string} eventName - 事件名称 (例如 'tags:updated', 'modules:project-alpha:updated')。
     * @param {function(any): void} callback - 事件触发时执行的回调函数。
     * @returns {function(): void} 一个用于取消订阅的函数。
     */
    subscribe(eventName, callback) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, []);
        }
        this.listeners.get(eventName).push(callback);

        // 返回一个取消订阅的函数，便于组件销毁时清理
        return () => {
            const callbacks = this.listeners.get(eventName);
            if (callbacks) {
                const index = callbacks.indexOf(callback);
                if (index > -1) {
                    callbacks.splice(index, 1);
                }
            }
        };
    }

    /**
     * 发布一个事件，通知所有订阅者。
     * @param {string} eventName - 事件名称。
     * @param {*} [data] - 传递给订阅者的数据。
     */
    publish(eventName, data) {
        if (this.listeners.has(eventName)) {
            // 创建副本以防止在回调中修改监听器列表时出现问题
            const callbacks = [...this.listeners.get(eventName)];
            callbacks.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event listener for '${eventName}':`, error);
                }
            });
        }
    }
}
