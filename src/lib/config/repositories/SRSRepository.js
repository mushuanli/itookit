// #config/repositories/SRSRepository.js

import { STORAGE_KEYS } from '../shared/constants.js';

// 为SRS数据定义新的存储键
const getSrsStorageKey = (ns, key) => `${STORAGE_KEYS.SRS_PREFIX}${ns}_${key}`;

/**
 * @class SRSRepository
 * @description 专门管理 Spaced Repetition System (SRS) 数据的仓库。
 * 职责：
 * 1. 对 ClozeState 进行原子化的 CRUD。
 * 2. 维护反向索引，以支持对文档范围和到期日期的高效查询。
 */
export class SRSRepository {
    constructor(namespace, persistenceAdapter, eventManager) {
        this.namespace = namespace;
        this.adapter = persistenceAdapter;
        this.eventManager = eventManager;

        // 存储键
        this.keys = {
            states: getSrsStorageKey(namespace, 'states'),
            docIndex: getSrsStorageKey(namespace, 'doc_index'),
            dueIndex: getSrsStorageKey(namespace, 'due_index'),
        };

        /** @private @type {Map<string, import('../shared/types.js').ClozeState> | null} */
        this._states = null;
        /** @private @type {Map<string, Set<string>> | null} documentId -> Set<clozeId> */
        this._docIndex = null;
        /** @private @type {Map<string, Set<string>> | null} YYYY-MM-DD -> Set<clozeId> */
        this._dueIndex = null;
        
        this._loadingPromise = null;
    }

    load() {
        if (this._loadingPromise) return this._loadingPromise;
        this._loadingPromise = (async () => {
            const [states, docIndex, dueIndex] = await Promise.all([
                this.adapter.getItem(this.keys.states) || [],
                this.adapter.getItem(this.keys.docIndex) || [],
                this.adapter.getItem(this.keys.dueIndex) || [],
            ]);

            this._states = new Map(states);
            // 将数组转换回 Set
            this._docIndex = new Map(docIndex.map(([key, arr]) => [key, new Set(arr)]));
            this._dueIndex = new Map(dueIndex.map(([key, arr]) => [key, new Set(arr)]));
            
            return true;
        })();
        return this._loadingPromise;
    }

    async _save() {
        if (!this._states) return;
        // 将 Set 转换为数组以便 JSON 序列化
        const serializableDocIndex = Array.from(this._docIndex.entries()).map(([key, set]) => [key, Array.from(set)]);
        const serializableDueIndex = Array.from(this._dueIndex.entries()).map(([key, set]) => [key, Array.from(set)]);

        await Promise.all([
            this.adapter.setItem(this.keys.states, Array.from(this._states.entries())),
            this.adapter.setItem(this.keys.docIndex, serializableDocIndex),
            this.adapter.setItem(this.keys.dueIndex, serializableDueIndex),
        ]);
    }

    async getCard(cardId) {
        await this.load();
        return this._states.get(cardId) || null;
    }

    async getCardsForDocument(documentId) {
        await this.load();
        const cardIds = this._docIndex.get(documentId) || new Set();
        return Array.from(cardIds).map(id => this._states.get(id)).filter(Boolean);
    }

    async getCardsDueOn(dateString) { // dateString in YYYY-MM-DD
        await this.load();
        const cardIds = this._dueIndex.get(dateString) || new Set();
        return Array.from(cardIds).map(id => this._states.get(id)).filter(Boolean);
    }

    async saveCard(newState) {
        await this.load();
        const oldState = this._states.get(newState.id);

        // 1. 清理旧索引
        if (oldState) {
            // 从 doc_index 移除
            const oldDocId = oldState.documentId;
            if (this._docIndex.has(oldDocId)) {
                this._docIndex.get(oldDocId).delete(oldState.id);
            }
            // 从 due_index 移除
            const oldDueDate = oldState.dueDate.substring(0, 10);
             if (this._dueIndex.has(oldDueDate)) {
                this._dueIndex.get(oldDueDate).delete(oldState.id);
            }
        }

        // 2. 更新数据
        this._states.set(newState.id, newState);

        // 3. 创建新索引
        // 更新 doc_index
        if (!this._docIndex.has(newState.documentId)) this._docIndex.set(newState.documentId, new Set());
        this._docIndex.get(newState.documentId).add(newState.id);
        
        // 更新 due_index
        const newDueDate = newState.dueDate.substring(0, 10);
        if (!this._dueIndex.has(newDueDate)) this._dueIndex.set(newDueDate, new Set());
        this._dueIndex.get(newDueDate).add(newState.id);

        await this._save();
    }
    
    async deleteCardsForDocument(documentId) {
        await this.load();
        const cardIds = this._docIndex.get(documentId) || new Set();
        if (cardIds.size === 0) return;

        for (const cardId of cardIds) {
            const state = this._states.get(cardId);
            if (state) {
                // 从 due_index 移除
                const dueDate = state.dueDate.substring(0, 10);
                if (this._dueIndex.has(dueDate)) {
                    this._dueIndex.get(dueDate).delete(cardId);
                }
                // 从主状态表移除
                this._states.delete(cardId);
            }
        }
        // 从文档索引移除
        this._docIndex.delete(documentId);
        
        await this._save();
    }
}
