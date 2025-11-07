// #configManager/repositories/SRSRepository.js

import { STORES, EVENTS } from '../constants.js';
import { generateShortUUID } from '@itookit/common';

export class SRSRepository {
    constructor(db, eventManager) {
        this.db = db;
        this.events = eventManager;
    }
    
    /**
     * 【改进】支持传入事务
     */
    async reconcileClozes(nodeId, content, transaction = null) {
        const clozeRegex = /\{\{c\d+::(.*?)\}\}(?:\s*\^([a-z0-9-]+))?/g;

        const tx = transaction || await this.db.getTransaction(STORES.SRS_CLOZES, 'readwrite');
        const store = tx.objectStore(STORES.SRS_CLOZES);
        
        let lastIndex = 0;
        let updatedContent = "";
        const foundClozeIds = new Set();
        const reconciledClozes = [];

        let match;
        while ((match = clozeRegex.exec(content)) !== null) {
            const [fullMatch, clozeText, existingId] = match;
            
            let clozeId = existingId || `clz-${generateShortUUID()}`;
            foundClozeIds.add(clozeId);

            updatedContent += content.substring(lastIndex, match.index);
            let newBlock = `{{c1::${clozeText}}}`;
            if (!existingId) {
                newBlock += ` ^${clozeId}`;
            } else {
                newBlock = fullMatch;
            }
            updatedContent += newBlock;
            lastIndex = clozeRegex.lastIndex;

            const existingCard = await new Promise(r => store.get(clozeId).onsuccess = e => r(e.target.result));
            const card = {
                status: 'new',
                dueAt: new Date(),
                interval: 0,
                easeFactor: 2.5,
                lapses: 0,
                ...existingCard,
                id: clozeId,
                nodeId,
                moduleName: nodeId.split('-')[0],
                content: clozeText,
            };
            reconciledClozes.push(card);
        }
        updatedContent += content.substring(lastIndex);

        const index = store.index('by_nodeId');
        const oldCards = await new Promise(r => index.getAll(nodeId).onsuccess = e => r(e.target.result));

        for (const oldCard of oldCards) {
            if (!foundClozeIds.has(oldCard.id)) {
                await store.delete(oldCard.id);
            }
        }
        
        for (const card of reconciledClozes) {
            await store.put(card);
        }

        return {
            updatedContent,
            clozes: reconciledClozes,
        };
    }

    /**
     * 获取需要复习的卡片队列
     * @param {{limit: number}} options
     * @returns {Promise<object[]>}
     */
    async getReviewQueue(options = { limit: 20 }) {
        const tx = await this.db.getTransaction(STORES.SRS_CLOZES, 'readonly');
        const store = tx.objectStore(STORES.SRS_CLOZES);
        const index = store.index('by_dueAt');
        
        const now = new Date();
        const range = IDBKeyRange.upperBound(now);
        
        const cards = [];
        return new Promise(resolve => {
            index.openCursor(range).onsuccess = event => {
                const cursor = event.target.result;
                if (cursor && cards.length < options.limit) {
                    cards.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(cards);
                }
            };
        });
    }

    /**
     * 用户回答一张卡片，并根据结果更新卡片状态
     * @param {string} clozeId
     * @param {'again' | 'hard' | 'good' | 'easy'} quality - 回答质量
     * @returns {Promise<object>} 更新后的卡片
     */
    async answerCard(clozeId, quality) {
        const tx = await this.db.getTransaction(STORES.SRS_CLOZES, 'readwrite');
        const store = tx.objectStore(STORES.SRS_CLOZES);
        const card = await new Promise(r => store.get(clozeId).onsuccess = e => r(e.target.result));
        
        if (!card) throw new Error("Card not found");

        let { interval = 0, easeFactor = 2.5, lapses = 0 } = card;

        if (quality === 'again') {
            interval = 1;
            lapses += 1;
        } else {
            if (card.status === 'new' || card.status === 'learning') {
                if (quality === 'good') interval = 1;
                if (quality === 'easy') interval = 4;
            } else {
                interval = Math.round(interval * easeFactor);
            }
            easeFactor += (0.1 - (5 - ['again', 'hard', 'good', 'easy'].indexOf(quality)) * (0.08 + (5 - ['again', 'hard', 'good', 'easy'].indexOf(quality)) * 0.02));
            if (easeFactor < 1.3) easeFactor = 1.3;
        }
        
        const now = new Date();
        const dueAt = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000);

        const updatedCard = {
            ...card,
            status: 'review',
            lastReviewedAt: now,
            dueAt,
            interval,
            easeFactor,
            lapses,
        };

        await store.put(updatedCard);
        this.events.publish(EVENTS.SRS_STATE_UPDATED, { cardId: clozeId, newState: updatedCard });
        return updatedCard;
    }

    /**
     * [移植新增] 重置一张卡片的学习进度。
     * @param {string} clozeId
     * @returns {Promise<object>} 重置后的卡片
     */
    async resetCard(clozeId) {
        const tx = await this.db.getTransaction(STORES.SRS_CLOZES, 'readwrite');
        const store = tx.objectStore(STORES.SRS_CLOZES);
        const card = await new Promise(r => store.get(clozeId).onsuccess = e => r(e.target.result));

        if (!card) throw new Error("Card not found");

        const resetCard = {
            ...card,
            status: 'new',
            dueAt: new Date(),
            lastReviewedAt: null,
            interval: 0,
            easeFactor: 2.5,
            lapses: 0,
        };

        await store.put(resetCard);
        this.events.publish(EVENTS.SRS_STATE_UPDATED, { cardId: clozeId, newState: resetCard });
        return resetCard;
    }

    /**
     * [移植新增] 获取一个文档的所有卡片状态
     * @param {string} nodeId
     * @returns {Promise<Map<string, object>>}
     */
    async getStatesForDocument(nodeId) {
        const cards = await this.db.getAllByIndex(STORES.SRS_CLOZES, 'by_nodeId', nodeId);
        return new Map(cards.map(card => [card.id, card]));
    }
}
