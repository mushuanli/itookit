/**
 * @file vfs-ui/core/Coordinator.js
 * @desc Implements the Coordinator, an event bus for decoupled communication.
 */

/**
 * A central event bus to facilitate communication between different parts
 * of the application without them having to know about each other.
 */
export class Coordinator {
    constructor() {
        /**
         * A map to store event listeners.
         * The key is the event channel (string), and the value is a Set of listener functions.
         * @private
         * @type {Map<string, Set<Function>>}
         */
        this.channels = new Map();
    }

    /**
     * Publishes an event to a specific channel, notifying all subscribers.
     * @param {string} channel - The name of the channel to publish to (e.g., 'NODE_SELECT_REQUESTED').
     * @param {*} data - The data payload to send with the event.
     */
    publish(channel, data) {
        const listeners = this.channels.get(channel);
        if (!listeners || listeners.size === 0) {
            return; // No one is listening, do nothing.
        }

        const event = {
            channel,
            data,
            timestamp: Date.now(),
        };

        listeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.error(`Error in listener for channel "${channel}":`, error);
            }
        });
    }

    /**
     * Subscribes a listener function to a specific channel.
     * @param {string} channel - The name of the channel to subscribe to.
     * @param {Function} listener - The callback function to execute when the event is published.
     * @returns {Function} An unsubscribe function to remove this specific listener.
     */
    subscribe(channel, listener) {
        if (!this.channels.has(channel)) {
            this.channels.set(channel, new Set());
        }

        const listeners = this.channels.get(channel);
        listeners.add(listener);

        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) {
                this.channels.delete(channel);
            }
        };
    }

    /**
     * FIX [8]: Clears all event listeners from all channels.
     * This is a public method for cleanup during component destruction.
     */
    clearAll() {
        this.channels.clear();
    }
}
