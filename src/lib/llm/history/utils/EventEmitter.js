/**
 * #llm/history/utils/EventEmitter.js
 * @file Simple event emitter implementation
 */

export class EventEmitter {
    constructor() {
        this._events = new Map();
    }
    
    /**
     * Register event listener
     * @param {string} eventName
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    on(eventName, callback) {
        if (!this._events.has(eventName)) {
            this._events.set(eventName, []);
        }
        
        this._events.get(eventName).push(callback);
        
        // Return unsubscribe function
        return () => this.off(eventName, callback);
    }
    
    /**
     * Register one-time event listener
     * @param {string} eventName
     * @param {Function} callback
     */
    once(eventName, callback) {
        const wrapper = (...args) => {
            callback(...args);
            this.off(eventName, wrapper);
        };
        this.on(eventName, wrapper);
    }
    
    /**
     * Remove event listener
     * @param {string} eventName
     * @param {Function} callback
     */
    off(eventName, callback) {
        if (!this._events.has(eventName)) return;
        
        const listeners = this._events.get(eventName);
        const index = listeners.indexOf(callback);
        
        if (index > -1) {
            listeners.splice(index, 1);
        }
        
        if (listeners.length === 0) {
            this._events.delete(eventName);
        }
    }
    
    /**
     * Emit event
     * @param {string} eventName
     * @param {*} payload
     */
    emit(eventName, payload) {
        if (!this._events.has(eventName)) return;
        
        const listeners = this._events.get(eventName).slice(); // Clone to avoid modification during iteration
        listeners.forEach(callback => {
            try {
                callback(payload);
            } catch (error) {
                console.error(`Error in event listener for "${eventName}":`, error);
            }
        });
    }
    
    /**
     * Remove all listeners
     * @param {string} [eventName] - If provided, only remove listeners for this event
     */
    removeAllListeners(eventName) {
        if (eventName) {
            this._events.delete(eventName);
        } else {
            this._events.clear();
        }
    }
}
