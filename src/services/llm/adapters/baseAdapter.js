// src/services/llm/adapters/baseAdapter.js

export class BaseAdapter {
    constructor(config) {
        this.config = config; // { apiKey, apiPath, model, systemPrompt, ... }
    }

    /**
     * @param {Array} messages - 对话历史
     * @param {object} callbacks - 包含 onChunk, onDone, onError 的回调对象
     */
    async chatStream(messages, { onChunk, onDone, onError }) {
        throw new Error("Adapter must implement chatStream method.");
    }

    _preparePayload(messages) {
        throw new Error("Adapter must implement _preparePayload method.");
    }
}