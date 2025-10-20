// #configManager/EventManager.js

/**
 * @class EventManager
 * @description [移植] 一个简单的发布/订阅事件管理器，用于在应用程序的不同部分之间解耦通信。
 */
export class EventManager {
    constructor() {
        this.listeners = new Map();
    }

    /**
     * 订阅一个事件。
     * @param {string} eventName - 事件名称。
     * @param {function(any): void} callback - 回调函数。
     * @returns {function(): void} 一个用于取消订阅的函数。
     */
    subscribe(eventName, callback) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, []);
        }
        this.listeners.get(eventName).push(callback);

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
