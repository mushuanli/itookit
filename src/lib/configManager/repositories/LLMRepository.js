// #configManager/repositories/LLMRepository.js
import { STORES, EVENTS } from '../constants.js';

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
        const result = await new Promise(resolve => store.get(key).onsuccess = e => resolve(e.target.result));
        return result ? result.value : [];
    }

    async _saveConfig(key, value) {
        const tx = await this.db.getTransaction(STORES.LLM_CONFIG, 'readwrite');
        const store = tx.objectStore(STORES.LLM_CONFIG);
        await store.put({ key, value });
        this.events.publish(EVENTS.LLM_CONFIG_UPDATED, { key, value });
    }

    async getConnections() {
        return this._getConfig('connections');
    }
    async saveConnections(connections) {
        await this._saveConfig('connections', connections);
    }

    async getAgents() {
        return this._getConfig('agents');
    }
    async saveAgents(agents) {
        await this._saveConfig('agents', agents);
    }

    async getWorkflows() {
        return this._getConfig('workflows');
    }
    async saveWorkflows(workflows) {
        await this._saveConfig('workflows', workflows);
    }
}
