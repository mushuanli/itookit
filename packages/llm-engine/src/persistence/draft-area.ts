// @file: llm-engine/src/persistence/draft-area.ts
// Standalone VFSDraftArea implementation extracted from chat-engine-log.ts.
//
// Fix (§2-D): uses the FSNode.path returned by createAsset() consistently for
// both writeContent() and delete(). IChatEngine methods accept FSNode paths as
// IDs at this abstraction level, so mixing path with a different nodeId concept
// is avoided by always passing the path through a single _draftPath variable.

import type { Turn, DraftArea, PauseRequest } from '@itookit/common';
import type { IChatEngine } from './types';

/**
 * DraftArea backed by VFS for crash safety.
 *
 * In-flight turn is kept in memory for fast read/write during streaming.
 * On checkpoint (pause), the turn is persisted to the session's asset
 * directory as 'draft.json' so it survives a process crash.
 * On flush (successful append), the persisted copy is deleted.
 */
export class VFSDraftArea implements DraftArea {
    private _current: Turn | null = null;
    /** FSNode.path of the persisted draft asset — null if not yet written. */
    private _draftPath: string | null = null;

    constructor(
        private readonly engine: IChatEngine,
        private readonly getSessionNodeId: () => Promise<string | null>,
    ) {}

    async checkpoint(_pause: PauseRequest): Promise<void> {
        if (!this._current) return;
        const nodeId = await this.getSessionNodeId();
        if (!nodeId) return;
        try {
            const content = JSON.stringify({
                ...this._current,
                meta: { ...this._current.meta, _checkpointAt: Date.now() },
            });
            if (this._draftPath) {
                await this.engine.driver.writeContent(this._draftPath, content);
            } else {
                const created = await this.engine.createAsset(nodeId, 'draft.json', content);
                this._draftPath = created.path;
            }
        } catch {
            // Non-critical: draft persistence failure must not crash the loop
        }
    }

    async flush(_turn: Turn): Promise<void> {
        this._current = null;
        if (this._draftPath) {
            try {
                await this.engine.delete([this._draftPath]);
            } catch { /* best-effort */ }
            this._draftPath = null;
        }
    }

    current(): Turn | null {
        return this._current;
    }

    setCurrent(turn: Turn): void {
        this._current = turn;
    }

    async restore(): Promise<Turn | null> {
        const nodeId = await this.getSessionNodeId();
        if (!nodeId) return null;
        try {
            const assets = await this.engine.getAssets(nodeId);
            const draftAsset = assets.find(a => a.name === 'draft.json');
            if (!draftAsset) return null;
            const content = await this.engine.readContent(draftAsset.path);
            if (typeof content === 'string') {
                this._current = JSON.parse(content);
                this._draftPath = draftAsset.path;
                return this._current;
            }
        } catch { /* ignore */ }
        return null;
    }
}
