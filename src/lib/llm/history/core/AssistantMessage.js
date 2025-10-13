/**
 * #llm/history/core/AssistantMessage.js
 * @file Assistant message model
 */

export class AssistantMessage {
    /**
     * @param {object} data - Message data
     * @param {MessagePair} pair - Parent message pair
     */
    constructor(data, pair) {
        this.pair = pair;
        this.content = data.content || '';
        this.thinking = data.thinking || null; // Thinking process
        
        // Editor/Renderer instance
        this.editorInstance = null;
        
        // Streaming state
        this.isStreaming = false;
        this.streamBuffer = '';
        
        // Thinking elements
        this.thinkingElement = null;

        // +++ ADDED FOR ERROR STYLING +++
        this.hasError = data.hasError || false;
    }
    
    /**
     * Start streaming
     */
    startStreaming() {
        this.isStreaming = true;
        this.streamBuffer = '';
    }
    
    /**
     * Append streaming content
     * @param {string} chunk
     */
    appendStream(chunk) {
        this.streamBuffer += chunk;
        this.content += chunk;
        
        if (this.editorInstance && this.editorInstance.append) {
            this.editorInstance.append(chunk);
        }
    }
    
    /**
     * Append thinking content
     * @param {string} chunk
     */
    appendThinking(chunk) {
        if (!this.thinking) {
            this.thinking = '';
        }
        this.thinking += chunk;
    }
    
    /**
     * Finalize streaming
     */
    finalizeStreaming() {
        this.isStreaming = false;
        
        if (this.editorInstance && this.editorInstance.finalize) {
            this.editorInstance.finalize();
        }
    }
    
    /**
     * Serialize to JSON
     * @returns {object}
     */
    toJSON() {
        return {
            content: this.content,
            thinking: this.thinking,
            // +++ ADDED FOR SERIALIZATION +++
            hasError: this.hasError 
        };
    }
}
