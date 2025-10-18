// @file #config/services/SRSService.js

import { EVENTS } from '../shared/constants.js';

/**
 * @typedef {import('../shared/types.js').ClozeState} ClozeState
 * @typedef {import('../repositories/SRSRepository.js').SRSRepository} SRSRepository
 * @typedef {import('../repositories/ModuleRepository.js').ModuleRepository} ModuleRepository
 * @typedef {import('../EventManager.js').EventManager} EventManager
 */

/**
 * @class SRSService
 * @description
 * The central hub for all Spaced Repetition System (SRS) business logic.
 * This service coordinates between the data layer (SRSRepository) and the
 * file structure context (ModuleRepository) to provide high-level, efficient
 * operations for scheduling, grading, and querying review items. It is the
 * single source of truth for SRS state within a given workspace.
 */
export class SRSService {
    /**
     * @param {SRSRepository} srsRepository - The data repository for SRS states and indexes.
     * @param {ModuleRepository} moduleRepository - The repository for the workspace's file/folder structure.
     * @param {EventManager} eventManager - The application's global event bus.
     */
    constructor(srsRepository, moduleRepository, eventManager) {
        this.srsRepo = srsRepository;
        this.moduleRepo = moduleRepository;
        this.events = eventManager;
        
        /**
         * The interval in days at which a card is considered 'mature'.
         * @type {number}
         */
        this.matureInterval = 21;
    }

    // ===================================================================
    // ==================== PUBLIC CORE API ==============================
    // ===================================================================

    /**
     * Grades a card, calculates its next review state, and persists the changes.
     * This is the primary entry point for updating a card's learning progress.
     * @param {string} cardId - The unique ID of the card to grade.
     * @param {'again' | 'hard' | 'good' | 'easy'} rating - The user's recall performance rating.
     * @param {string} documentId - The ID of the document containing the card.
     * @returns {Promise<ClozeState>} The newly calculated state of the card.
     */
    async gradeCard(cardId, rating, documentId) {
        const currentState = await this.srsRepo.getCard(cardId);
        const newState = this._calculateNextState(cardId, currentState, rating);
        newState.documentId = documentId; // Ensure documentId is correctly associated

        await this.srsRepo.saveCard(newState);
        this.events.publish(EVENTS.SRS_STATE_UPDATED, { cardId: newState.id, newState });
        
        return newState;
    }

    /**
     * Resets a card's progress back to its initial 'new' state.
     * Useful for when a user wants to re-learn a mature card.
     * @param {string} cardId - The unique ID of the card to reset.
     * @param {string} documentId - The ID of the document containing the card.
     * @returns {Promise<ClozeState>} The new, reset state of the card.
     */
    async resetCard(cardId, documentId) {
        const newState = {
            id: cardId,
            documentId: documentId,
            tier: 'new',
            dueDate: new Date().toISOString(),
            interval: 0,
            easeFactor: 2.5,
            repetitions: 0,
        };
        await this.srsRepo.saveCard(newState);
        this.events.publish(EVENTS.SRS_STATE_UPDATED, { cardId: newState.id, newState });
        return newState;
    }

    /**
     * Generates a review queue of cards that are due for review within a specific scope.
     * @param {object} scope - Defines the document range for the review.
     * @param {'workspace' | 'directory' | 'file'} scope.type - The type of scope.
     * @param {string[]} [scope.ids] - An array of document or directory IDs for the scope.
     * @param {object} limits - The maximum number of new and review cards to include.
     * @param {number} limits.new - The limit for new cards.
     * @param {number} limits.review - The limit for cards in learning/review/mature states.
     * @returns {Promise<ClozeState[]>} An array of card states ready for review.
     */
    async getDueCards(scope, limits) {
        const docIdsInScope = await this._getDocIdsInScope(scope);
        
        // Efficiently fetch all cards due today or earlier
        const today = new Date();
        let allDueCards = [];
        // Look back up to 1 year for overdue cards, which should be sufficient.
        for (let i = 0; i < 365; i++) { 
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            const dateString = date.toISOString().substring(0, 10);
            
            // This query is fast thanks to the due_index
            const cardsOnDate = await this.srsRepo.getCardsDueOn(dateString);
            allDueCards.push(...cardsOnDate);
        }

        // Filter these cards to only include those within the specified scope
        const scopedCards = allDueCards.filter(c => docIdsInScope.has(c.documentId));

        // 分离新旧卡片并应用限制
        const newCards = scopedCards.filter(c => c.tier === 'new').slice(0, limits.new);
        const reviewCards = scopedCards.filter(c => c.tier !== 'new').slice(0, limits.review);

        // Combine and return the final queue
        return [...newCards, ...reviewCards];
    }
    
    /**
     * A convenience method to quickly get the total number of due cards in a scope.
     * @param {object} scope - The scope to query.
     * @returns {Promise<number>} The total count of due cards.
     */
    async getDueCardCount(scope) {
        // Call with high limits to get all due cards, then return the length.
        const dueCards = await this.getDueCards(scope, { new: 99999, review: 99999 });
        return dueCards.length;
    }

    /**
     * Gathers and aggregates statistics about the card states within a given scope.
     * @param {object} scope - The scope for which to generate statistics.
     * @returns {Promise<object>} An object containing counts for each card tier and a total.
     */
    async getStatistics(scope) {
        const docIdsInScope = await this._getDocIdsInScope(scope);
        const stats = { new: 0, learning: 0, review: 0, mature: 0, total: 0 };
        
        for (const docId of docIdsInScope) {
            // This query is fast thanks to the doc_index
            const cards = await this.srsRepo.getCardsForDocument(docId);
            for (const card of cards) {
                if (stats[card.tier] !== undefined) {
                    stats[card.tier]++;
                }
                stats.total++;
            }
        }
        return stats;
    }
    
    /**
     * Retrieves all card states for a single document.
     * This is used by plugins like MemoryPlugin to render the initial state of clozes.
     * @param {string} documentId - The ID of the document.
     * @returns {Promise<Map<string, ClozeState>>} A map from cardId to ClozeState for easy lookup.
     */
    async getStatesForDocument(documentId) {
        const cards = await this.srsRepo.getCardsForDocument(documentId);
        return new Map(cards.map(c => [c.id, c]));
    }
    
    /**
     * Handles the deletion of a document by removing all associated SRS data.
     * Ensures data integrity by preventing orphaned card states.
     * @param {string} documentId - The ID of the document being deleted.
     * @returns {Promise<void>}
     */
    async handleDocumentDeletion(documentId) {
        await this.srsRepo.deleteCardsForDocument(documentId);
        this.events.publish(EVENTS.SRS_STATE_UPDATED, { deletedDocument: documentId });
    }

    // ===================================================================
    // ==================== PRIVATE HELPERS ==============================
    // ===================================================================

    /**
     * Resolves a scope object into a flat set of unique document IDs.
     * @private
     * @param {object} scope - The scope object.
     * @returns {Promise<Set<string>>} A Set containing all document IDs within the scope.
     */
    async _getDocIdsInScope(scope) {
        await this.moduleRepo.load();
        const rootNode = await this.moduleRepo.getModules();
        const docIds = new Set();
        
        let initialNodeIds = [];
        if (scope.type === 'workspace') {
            initialNodeIds.push(rootNode.meta.id);
        } else {
            initialNodeIds = scope.ids || [];
        }

        const traverseAndCollect = (currentNode) => {
            if (currentNode.type === 'file') {
                docIds.add(currentNode.meta.id);
            }
            if (currentNode.children) {
                currentNode.children.forEach(traverseAndCollect);
            }
        };

        for (const id of initialNodeIds) {
            const startNode = this.moduleRepo._findNodeById(id)?.node;
            if (startNode) {
                traverseAndCollect(startNode);
            }
        }
        return docIds;
    }

    /**
     * The core SM-2-like SRS algorithm. This is a pure function.
     * @private
     * @param {string} cardId - The card's ID.
     * @param {ClozeState | null} currentState - The current state, or null if it's a new card.
     * @param {'again' | 'hard' | 'good' | 'easy'} rating - The user's rating.
     * @returns {ClozeState} The newly computed state.
     */
    _calculateNextState(cardId, currentState, rating) {
        // Initialize state for a new card
        const state = currentState || {
            id: cardId,
            tier: 'new',
            easeFactor: 2.5,
            interval: 0,
            repetitions: 0,
        };
        // Ensure dueDate is a Date object for calculations if it's a string
        if (typeof state.dueDate === 'string') {
            state.dueDate = new Date(state.dueDate);
        }

        // 1. Handle "Again" rating (reset learning)
        if (rating === 'again') {
            state.repetitions = 0;
            state.interval = 1; // Reschedule for tomorrow
            state.tier = 'learning';
        } else {
            // 2. Handle successful recall ("Hard", "Good", "Easy")
            state.repetitions = (state.repetitions || 0) + 1;
            
            // Adjust ease factor based on performance
            if (rating === 'hard') state.easeFactor = Math.max(1.3, state.easeFactor - 0.15);
            if (rating === 'easy') state.easeFactor += 0.15;
            // "Good" does not change the ease factor.
            
            // Calculate next interval
            if (state.repetitions <= 1) {
                state.interval = 1; // 1 day
            } else if (state.repetitions === 2) {
                state.interval = 6; // 6 days
            } else {
                state.interval = Math.ceil(state.interval * state.easeFactor);
            }
            
            state.tier = state.interval > this.matureInterval ? 'mature' : 'review';
        }
        
        // 3. Set the next due date
        const now = new Date();
        now.setHours(0, 0, 0, 0); // Normalize to the start of the day
        const nextDueDate = new Date(now.setDate(now.getDate() + state.interval));
        
        // Return a clean state object with a serialized date
        return {
            ...state,
            dueDate: nextDueDate.toISOString(),
        };
    }
}
