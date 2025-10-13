/**
 * #llm/history/core/BranchManager.js
 * @file Manages conversation branches (when editing history)
 */

export class BranchManager {
    constructor(historyUI) {
        this.historyUI = historyUI;
        this.branches = new Map(); // pairId -> branches[]
    }
    
    /**
     * Create a new branch from an existing pair.
     * @param {MessagePair} originalPair - The pair from which the branch originates.
     * @param {MessagePair} newPair - The new pair starting the new branch.
     */
    createBranch(originalPair, newPair) {
        const originalPairId = originalPair.id;

        if (!this.branches.has(originalPairId)) {
            // +++ If this is the first branch, also add the original pair's info as a branch
            this.branches.set(originalPairId, [{
                id: originalPair.id,
                content: originalPair.userMessage.content,
                agent: originalPair.metadata.agent,
                timestamp: originalPair.metadata.createdAt,
                isOriginal: true // Mark this as the original path
            }]);
        }
        
        const branches = this.branches.get(originalPairId);
        branches.push({
            id: newPair.id,
            content: newPair.userMessage.content,
            agent: newPair.metadata.agent,
            timestamp: newPair.metadata.createdAt
        });
        
        newPair.metadata.branch = {
            parent: originalPairId,
            index: branches.length
        };
    }
    
    /**
     * Get branches for a pair
     * @param {string} pairId
     * @returns {Array}
     */
    getBranches(pairId) {
        return this.branches.get(pairId) || [];
    }
    
    /**
     * Check if pair has branches
     * @param {string} pairId
     * @returns {boolean}
     */
    hasBranches(pairId) {
        const branches = this.branches.get(pairId);
        // +++ A pair has branches if there is more than one path
        return branches && branches.length > 1;
    }
    
    /**
     * Serialize branches to a plain object for JSON storage.
     * @returns {object}
     */
    toJSON() {
        return Object.fromEntries(this.branches.entries());
    }

    /**
     * Load branches from a plain object.
     * @param {object} json - The branch data object.
     */
    fromJSON(json) {
        if (!json) return;
        this.branches = new Map(Object.entries(json));
    }
    
    /**
     * Clear all branches
     */
    clear() {
        this.branches.clear();
    }
}
