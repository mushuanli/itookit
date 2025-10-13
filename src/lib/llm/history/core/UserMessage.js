/**
 * #llm/history/core/UserMessage.js
 * @file User message model
 */

export class UserMessage {
    /**
     * @param {object} data - Message data
     * @param {MessagePair} pair - Parent message pair
     */
    constructor(data, pair) {
        this.pair = pair;
        this.content = data.content || '';
        this.attachments = data.attachments || []; // { type, url, name }[]
        this.agent = data.agent || 'default';
        
        // Editor instance (MDxEditor)
        this.editorInstance = null;
        
        // State
        this.isEditing = false;
    }
    
    /**
     * Start editing mode
     */
    startEdit() {
        if (this.editorInstance && !this.isEditing) {
            this.editorInstance.switchTo('edit');
            this.isEditing = true;
        }
    }
    
    /**
     * Stop editing mode
     */
    stopEdit() {
        if (this.editorInstance && this.isEditing) {
            this.content = this.editorInstance.getText();
            this.editorInstance.switchTo('render');
            this.isEditing = false;
        }
    }
    
    /**
     * Add attachment
     * @param {object} attachment - { type, url, name, size }
     */
    addAttachment(attachment) {
        this.attachments.push(attachment);
    }
    
    /**
     * Remove attachment
     * @param {number} index
     */
    removeAttachment(index) {
        if (index >= 0 && index < this.attachments.length) {
            this.attachments.splice(index, 1);
        }
    }
    
    /**
     * Serialize to JSON
     * @returns {object}
     */
    toJSON() {
        return {
            content: this.content,
            attachments: this.attachments,
            agent: this.agent
        };
    }
}
