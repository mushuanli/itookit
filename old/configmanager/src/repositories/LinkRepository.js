// #configManager/repositories/LinkRepository.js

import { STORES } from '../constants.js';

export class LinkRepository {
    constructor(db, eventManager) {
        this.db = db;
        this.events = eventManager;
    }

    /**
     * 【改进】支持传入事务
     */
    async updateLinksForNode(sourceNodeId, content, transaction = null) {
        if (!sourceNodeId) {
            console.warn("updateLinksForNode called with invalid sourceNodeId, operation skipped.");
            return;
        }

        const linkRegex = /\[\[([a-zA-Z0-9_-]+-[0-9a-fA-F-]+)\]\]/g;
        let match;
        const targetNodeIds = new Set();
        while ((match = linkRegex.exec(content)) !== null) {
            targetNodeIds.add(match[1]);
        }
        
        const tx = transaction || await this.db.getTransaction(STORES.LINKS, 'readwrite');
        const store = tx.objectStore(STORES.LINKS);
        const index = store.index('by_source');

        await new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.only(sourceNodeId));
            request.onsuccess = event => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = reject;
        });

        for (const targetNodeId of targetNodeIds) {
            try {
                await store.put({ sourceNodeId, targetNodeId });
            } catch (error) {
                if (error.name !== 'ConstraintError') {
                    throw error;
                }
            }
        }
    }

    async getBacklinks(targetNodeId) {
        const links = await this.db.getAllByIndex(STORES.LINKS, 'by_target', targetNodeId);
        const sourceNodeIds = links.map(link => link.sourceNodeId);

        if (sourceNodeIds.length === 0) return [];
        
        const tx = await this.db.getTransaction(STORES.NODES, 'readonly');
        const store = tx.objectStore(STORES.NODES);
        
        const nodes = await Promise.all(
            sourceNodeIds.map(id => new Promise((resolve, reject) => {
                const request = store.get(id);
                request.onsuccess = e => resolve(e.target.result);
                request.onerror = reject;
            }))
        );

        return nodes.filter(Boolean);
    }
}
