/**
 * #llm/history/core/MessagePair.js
 * @file Message pair model (user + assistant)
 */

import { UserMessage } from './UserMessage.js';
import { AssistantMessage } from './AssistantMessage.js';
import { generateID } from '../utils/IDGenerator.js';

export class MessagePair {
    /**
     * @param {object} userData - User message data
     * @param {object} assistantData - Assistant message data
     * @param {string} [id] - Optional custom ID
     */
    constructor(userData = {}, assistantData = {}, id = null) {
        this.id = id || generateID('pair');
        this.userMessage = new UserMessage(userData, this);
        this.assistantMessage = new AssistantMessage(assistantData, this);
        
        this.metadata = {
            createdAt: Date.now(),
            agent: userData.agent || 'default',
            branch: null, // 分支信息
        toolChoice: userData.toolChoice || null,      // +++ 新增
        systemPrompt: userData.systemPrompt || null   // +++ 新增
        };
        
        // DOM references
        this.element = null;
        this.userElement = null;
        this.assistantElement = null;
    }
    
    /**
     * Check if this is the last pair in the history
     * @param {LLMHistoryUI} historyUI
     * @returns {boolean}
     */
    isLast(historyUI) {
        if (!historyUI.pairs.length) return false;
        return historyUI.pairs[historyUI.pairs.length - 1] === this;
    }
    
    /**
     * Check if this pair can be edited
     * @param {LLMHistoryUI} historyUI
     * @returns {boolean}
     */
    canEdit(historyUI) {
        return !historyUI.isLocked;
    }
    
    /**
     * Check if this pair can be deleted
     * @param {LLMHistoryUI} historyUI
     * @returns {boolean}
     */
    canDelete(historyUI) {
        return !historyUI.isLocked;
    }
    
    /**
     * Serialize to JSON
     * @returns {object}
     */
    toJSON() {
        return {
            id: this.id,
            userMessage: this.userMessage.toJSON(),
            assistantMessage: this.assistantMessage.toJSON(),
            metadata: this.metadata
        };
    }
    
    /**
     * Create from JSON
     * @param {object} json
     * @returns {MessagePair}
     */
    static fromJSON(json) {
        const pair = new MessagePair(
            json.userMessage,
            json.assistantMessage,
            json.id
        );
        pair.metadata = json.metadata;
        return pair;
    }
    
    /**
     * Destroy and cleanup
     */
    destroy() {
        if (this.userMessage.editorInstance) {
            this.userMessage.editorInstance.destroy();
        }
        if (this.assistantMessage.editorInstance) {
            this.assistantMessage.editorInstance.destroy();
        }
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }
}
