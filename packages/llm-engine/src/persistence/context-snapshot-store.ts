// @file: llm-engine/src/persistence/context-snapshot-store.ts
// ContextSnapshotStore — persist and load frozen ContextSnapshots.
//
// Phase 2 (WP-03): Each ContextSnapshot is immutable once created.
// Snapshots are stored alongside round files in the session asset directory.
//
// Storage layout:
//   context-snapshot-<snapshotId>.json

import type {
    ContextSnapshot,
    ContextSnapshotId,
} from '@itookit/common';
import type { IChatEngine } from './types';
import { ulid } from './ulid';

export class ContextSnapshotStore {
    constructor(
        private readonly engine: IChatEngine,
        private readonly nodeId: string,
    ) {}

    /** Persist a ContextSnapshot. Computes digest before writing. */
    async save(snapshot: ContextSnapshot): Promise<ContextSnapshot> {
        // Compute content digest for audit/reproducibility
        const content = JSON.stringify(snapshot.canonicalMessages);
        const digest = await this.sha256(content);

        const persisted: ContextSnapshot = {
            ...snapshot,
            id: snapshot.id || ulid() as ContextSnapshotId,
            digest,
        };

        await this.engine.createAsset(
            this.nodeId,
            `context-snapshot-${persisted.id}.json`,
            JSON.stringify(persisted, null, 2),
        );

        return persisted;
    }

    /** Load a previously saved ContextSnapshot. */
    async load(id: ContextSnapshotId): Promise<ContextSnapshot | null> {
        try {
            const file = this.engine.openFile(this.nodeId);
            const text = await file.asset(`context-snapshot-${id}.json`).readText();
            if (text) return JSON.parse(text) as ContextSnapshot;
        } catch { /* snapshot file missing */ }
        return null;
    }

    /** Verify that a snapshot's digest matches its canonical messages. */
    async verify(snapshot: ContextSnapshot): Promise<boolean> {
        const content = JSON.stringify(snapshot.canonicalMessages);
        const computed = await this.sha256(content);
        return computed === snapshot.digest;
    }

    // ── Private ──────────────────────────────────────────────────────────

    private async sha256(input: string): Promise<string> {
        // Use Web Crypto API (available in browser and Node 19+)
        const encoder = new TextEncoder();
        const data = encoder.encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
}
