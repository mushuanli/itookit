/**
 * #common/interfaces/IMemoryProvider.js
 * @file Defines the contract for providing Spaced Repetition System (SRS) logic and data to MDxEditor.
 */

/**
 * Defines the distinct stages of a cloze in the memory cycle.
 * - `new`: Never studied.
 * - `learning`: In the initial learning phase with short steps.
 * - `review`: Graduated from learning, in normal review intervals.
 * - `mature`: Long-term memory, interval is typically > 21 days.
 * @typedef {'new' | 'learning' | 'review' | 'mature'} ClozeMemoryTier
 */

/**
 * Represents the full state of a single cloze deletion from a memory perspective.
 * @typedef {object} ClozeState
 * @property {string} id - The unique identifier for the cloze.
 * @property {ClozeMemoryTier} tier - The current memory tier.
 * @property {number} [interval] - The next review interval in days.
 * @property {number} [easeFactor] - The ease factor or difficulty rating (e.g., 2.5 for 250%).
 * @property {Date} [dueDate] - The exact date this cloze is due for review.
 * @property {any} [customData] - A slot for the host application to store any extra data.
 */

/**
 * The user's rating of their recall performance for a cloze.
 * @typedef {'again' | 'hard' | 'good' | 'easy'} UserRating
 */

/**
 * The IMemoryProvider interface defines how MDxEditor's memory system communicates
 * with an external SRS algorithm and data store provided by the host application.
 *
 * A host application must implement this interface and pass an instance to the MemoryPlugin.
 * @interface
 */
export class IMemoryProvider {
    /**
     * Called after the editor renders content to fetch the initial states for all visible clozes.
     * @param {string[]} clozeIds - An array of all cloze IDs present in the rendered content.
     * @returns {Promise<Map<string, ClozeState>>} A Promise that resolves to a Map from clozeId to its state object. For new clozes, the map can simply omit the key.
     */
    async getInitialStates(clozeIds) {
        throw new Error("IMemoryProvider: Method 'getInitialStates' must be implemented.");
    }

    /**
     * Called when a user rates their recall of a revealed cloze. This is the core entry point for the SRS algorithm.
     * @param {string} clozeId - The ID of the cloze being graded.
     * @param {ClozeState | null} currentState - The current state of the cloze, or null if it's a new card.
     * @param {UserRating} rating - The user's rating.
     * @returns {Promise<ClozeState>} A Promise that resolves to the new state as calculated by the SRS algorithm.
     */
    async grade(clozeId, currentState, rating) {
        throw new Error("IMemoryProvider: Method 'grade' must be implemented.");
    }
    
    /**
     * Called immediately after a cloze's state is updated by the `grade` method.
     * The host application should handle data persistence (e.g., saving to a database) in this method.
     * @param {ClozeState} newState - The new state of the cloze to be saved.
     * @returns {Promise<void>}
     */
    async onStateUpdate(newState) {
        throw new Error("IMemoryProvider: Method 'onStateUpdate' must be implemented.");
    }

    /**
     * [Optional] Called when a user requests to reset a cloze's progress (e.g., by double-clicking a mature cloze).
     * @param {string} clozeId - The ID of the cloze to reset.
     * @returns {Promise<ClozeState>} A Promise that resolves to the new, initial state for the cloze.
     */
    async resetState(clozeId) {
        console.warn(`IMemoryProvider: Method 'resetState' is not implemented. Defaulting to no-op for ${clozeId}.`);
        // Find the current state from the host app's storage and return it.
        // For this example, we can't do much. A real implementation would fetch/clear from a DB.
        const states = await this.getInitialStates([clozeId]);
        return states.get(clozeId);
    }
}
