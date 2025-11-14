// #configManager/repositories/LLMRepository.js
import { STORES, EVENTS, LLM_CONFIG_KEYS } from '../constants.js'; // [MODIFIED]

/**
 * @description [移植] 负责全局 LLM 配置 (Connections, Agents, Workflows) 的持久化。
 */
export class LLMRepository {
    constructor(db, eventManager) {
        this.db = db;
        this.events = eventManager;
    }

    async _getConfig(key) {
        const tx = await this.db.getTransaction(STORES.LLM_CONFIG, 'readonly');
        const store = tx.objectStore(STORES.LLM_CONFIG);
        const result = await new Promise((resolve, reject) => { // [FIX]
            const request = store.get(key);
            request.onsuccess = e => resolve(e.target.result);
            request.onerror = e => reject(e.target.error);
        });
        return result ? result.value : [];
    }

    async _saveConfig(key, value) {
        const tx = await this.db.getTransaction(STORES.LLM_CONFIG, 'readwrite');
        const store = tx.objectStore(STORES.LLM_CONFIG);
        await store.put({ key, value });
        this.events.publish(EVENTS.LLM_CONFIG_UPDATED, { key, value });
    }

    async getConnections() {
        return this._getConfig(LLM_CONFIG_KEYS.CONNECTIONS); // [MODIFIED]
    }
    async saveConnections(connections) {
        await this._saveConfig(LLM_CONFIG_KEYS.CONNECTIONS, connections); // [MODIFIED]
    }

    async getAgents() {
        return this._getConfig(LLM_CONFIG_KEYS.AGENTS); // [MODIFIED]
    }
    async saveAgents(agents) {
        await this._saveConfig(LLM_CONFIG_KEYS.AGENTS, agents); // [MODIFIED]
    }

    async getWorkflows() {
        return this._getConfig(LLM_CONFIG_KEYS.WORKFLOWS); // [MODIFIED]
    }
    async saveWorkflows(workflows) {
        await this._saveConfig(LLM_CONFIG_KEYS.WORKFLOWS, workflows); // [MODIFIED]
    }
}
