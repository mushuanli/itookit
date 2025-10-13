/**
 * #llm/history/utils/IDGenerator.js
 * @file ID generation utilities
 */

let counters = new Map();

/**
 * Generate unique ID
 * @param {string} prefix - ID prefix
 * @returns {string}
 */
export function generateID(prefix = 'id') {
    if (!counters.has(prefix)) {
        counters.set(prefix, 0);
    }
    
    const count = counters.get(prefix);
    counters.set(prefix, count + 1);
    
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    
    return `${prefix}-${timestamp}-${count}-${random}`;
}

/**
 * Reset counter for a prefix
 * @param {string} prefix
 */
export function resetCounter(prefix) {
    counters.delete(prefix);
}

/**
 * Reset all counters
 */
export function resetAllCounters() {
    counters.clear();
}
