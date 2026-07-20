// @file: llm-engine/__tests__/round-log.test.ts
// Integration tests for RoundLog with an in-memory IChatEngine mock.
//
// Covers:
//   - RoundLog CRUD: append, fold, readRound, writeRound
//   - Delete semantics: user→cascade, assistant→keep, resend→no-branch
//   - Children reverse index + fold caching + soft-delete filtering
//   - Event emission: round:appended, round:updated, round:deleted

import { describe, it, expect, beforeEach } from 'vitest';
import type {
    Round, RoundId, Ref, ChatMessage, ILog, DraftArea, RefStore,
} from '@itookit/common';
import type { IChatEngine, FSNode } from '../src/persistence/types';
import type { RoundManifest, PersistedRound, RoundProjection } from '../src/persistence/round-types';
import type { RoundLogEvent } from '../src/persistence/round-events';
import { RoundLog, roundToProjection } from '../src/persistence/round-log';
import { SessionState } from '../src/session/session-state';

// ── In-memory IChatEngine mock ──────────────────────────────────────────────

class InMemoryChatEngine implements Partial<IChatEngine> {
    private manifest: Record<string, unknown> = {};
    /** ownerNodeId → Map<assetName, content> */
    private assets: Map<string, Map<string, string>> = new Map();
    private files: Map<string, string> = new Map();
    private children: Map<string, FSNode[]> = new Map();

    // ── Manifest ────────────────────────────────────────────────────────

    async getManifest(_nodeId: string): Promise<unknown> {
        const persisted = this.files.get(_nodeId);
        return persisted ? JSON.parse(persisted) : { ...this.manifest };
    }

    setManifest(m: Record<string, unknown>): void {
        this.manifest = m;
    }

    // ── Asset directory ─────────────────────────────────────────────────

    async getAssetDirectoryId(nodeId: string): Promise<string | null> {
        return `_${nodeId}`;
    }

    /** ownerNodeId is the .chat file id; name is relative asset filename */
    async createAsset(ownerNodeId: string, name: string, content: string): Promise<FSNode> {
        if (!this.assets.has(ownerNodeId)) this.assets.set(ownerNodeId, new Map());
        this.assets.get(ownerNodeId)!.set(name, content);
        const path = `_${ownerNodeId}/${name}`;
        this.files.set(path, content);
        return { path, name } as unknown as FSNode;
    }

    async getAssets(ownerNodeId: string): Promise<FSNode[]> {
        const map = this.assets.get(ownerNodeId) ?? new Map();
        return Array.from(map.keys()).map(name => ({
            name, path: `_${ownerNodeId}/${name}`,
        } as unknown as FSNode));
    }

    /** IFile handle backed by this mock's asset store */
    openFile(nodeId: string): import('@itookit/common').IFile {
        const engine = this;
        return {
            nodeId,
            asset(name: string) {
                return {
                    name,
                    async readText(): Promise<string | null> {
                        return engine.assets.get(nodeId)?.get(name) ?? null;
                    },
                    async read(): Promise<ArrayBuffer | null> {
                        const text = engine.assets.get(nodeId)?.get(name);
                        if (!text) return null;
                        return new TextEncoder().encode(text).buffer;
                    },
                    async write(content: string | ArrayBuffer | Uint8Array): Promise<string> {
                        const text = typeof content === 'string' ? content : new TextDecoder().decode(content as ArrayBuffer);
                        if (!engine.assets.has(nodeId)) engine.assets.set(nodeId, new Map());
                        engine.assets.get(nodeId)!.set(name, text);
                        return `@asset/${name}`;
                    },
                    async delete(): Promise<void> { engine.assets.get(nodeId)?.delete(name); },
                    async exists(): Promise<boolean> { return engine.assets.get(nodeId)?.has(name) ?? false; },
                };
            },
        } as unknown as import('@itookit/common').IFile;
    }

    // ── Content ──────────────────────────────────────────────────────────

    async readContent(path: string): Promise<string | ArrayBuffer> {
        if (this.files.has(path)) return this.files.get(path)!;
        throw new Error(`File not found: ${path}`);
    }

    // ── Directory ────────────────────────────────────────────────────────

    async getChildren(dirPath: string): Promise<FSNode[]> {
        return this.children.get(dirPath) ?? [];
    }

    async createDirectory(name: string, parentPath: string): Promise<FSNode> {
        const path = `${parentPath}/${name}`;
        this.children.set(path, []);
        return { path, name } as unknown as FSNode;
    }

    // ── Delete ───────────────────────────────────────────────────────────

    async delete(paths: string[]): Promise<void> {
        for (const p of paths) {
            this.files.delete(p);
        }
    }

    // ── Driver stub ──────────────────────────────────────────────────────

    driver = {
        writeContent: async (path: string, content: string) => {
            this.files.set(path, content);
        },
        getChildren: async (path: string) => this.getChildren(path),
    } as unknown as IChatEngine['driver'];
}

// ── Test helpers ────────────────────────────────────────────────────────────

function makeRound(overrides: Partial<Round> = {}): Round {
    return {
        id: '',
        parents: [],
        payload: [],
        ...overrides,
    };
}

function makeUserPayload(text: string): Round['payload'] {
    return [{ role: 'user' as const, content: text }];
}

function makeAssistantPayload(text: string): Round['payload'] {
    return [{ role: 'assistant' as const, content: text }];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('RoundLog', () => {
    let engine: InMemoryChatEngine;
    let log: RoundLog;
    let events: RoundLogEvent[];
    const nodeId = 'test-session.chat';
    const sessionId = 'test-session-id';

    beforeEach(() => {
        engine = new InMemoryChatEngine();
        engine.setManifest({
            id: sessionId,
            // format removed - default is round,
            rootRoundId: 'root',
            branches: { main: 'root' },
            current_branch: 'main',
            current_head: 'root',
            children: {},
        });
        events = [];
        log = new RoundLog(engine as unknown as IChatEngine, nodeId, sessionId);
        log.setEventListener((e) => events.push(e));
    });

    // ── Basic CRUD ────────────────────────────────────────────────────────

    describe('append & fold', () => {
        it('should append a round and fold returns its messages', async () => {
            const round = makeRound({ payload: [{ role: 'user', content: 'Hello' }] });
            const roundId = await log.append('main', round);

            const messages = await log.fold('main');
            expect(messages).toHaveLength(1);
            expect(messages[0]).toEqual({ role: 'user', content: 'Hello' });
        });

        it('should append multiple rounds and fold returns them in order', async () => {
            const t1 = makeRound({ payload: [{ role: 'user', content: 'Q1' }] });
            const t1Id = await log.append('main', t1);
            const t2 = makeRound({
                parents: [t1Id],
                payload: [{ role: 'assistant', content: 'A1' }],
            });
            const t2Id = await log.append('main', t2);
            const t3 = makeRound({
                parents: [t2Id],
                payload: [{ role: 'user', content: 'Q2' }],
            });
            await log.append('main', t3);

            const messages = await log.fold('main');
            expect(messages).toHaveLength(3);
            expect(messages[0]).toEqual({ role: 'user', content: 'Q1' });
            expect(messages[1]).toEqual({ role: 'assistant', content: 'A1' });
            expect(messages[2]).toEqual({ role: 'user', content: 'Q2' });
        });

        it('should NOT trim trailing assistant from fold (provider validation is Phase 2)', async () => {
            const t1 = makeRound({ payload: [{ role: 'user', content: 'Q1' }] });
            const t1Id = await log.append('main', t1);
            const t2 = makeRound({
                parents: [t1Id],
                payload: [{ role: 'assistant', content: 'A1' }],
            });
            await log.append('main', t2);

            // Phase 0: trailing assistant is NOT removed by fold().
            // Provider-specific validation will move to ProviderMessageAdapter in Phase 2.
            const messages = await log.fold('main');
            expect(messages).toHaveLength(2);
            expect(messages[0]).toEqual({ role: 'user', content: 'Q1' });
            expect(messages[1]).toEqual({ role: 'assistant', content: 'A1' });
        });

        it('should skip empty assistant messages in fold', async () => {
            const t1 = makeRound({ payload: [
                { role: 'user', content: 'Q1' },
                { role: 'assistant', content: '' },
            ]});
            await log.append('main', t1);

            const messages = await log.fold('main');
            expect(messages).toHaveLength(1);
            expect(messages[0].role).toBe('user');
        });
    });

    // ── Delete semantics (core acceptance criteria) ─────────────────────

    describe('delete user round → cascade delete assistant', () => {
        it('fold() should skip deleted rounds and SessionState should cascade', async () => {
            const t1Id = await log.append('main', makeRound({ payload: makeUserPayload('Q1') }));
            const t2Id = await log.append('main', makeRound({
                parents: [t1Id],
                payload: makeAssistantPayload('A1'),
            }));
            const t3Id = await log.append('main', makeRound({
                parents: [t2Id],
                payload: makeUserPayload('Q2'),
            }));
            const t4Id = await log.append('main', makeRound({
                parents: [t3Id],
                payload: makeAssistantPayload('A2'),
            }));

            // Delete user round T3 — T4 should cascade in SessionState projection
            await log.deleteRound(t3Id);

            // fold() skips _deleted rounds (T3).
            // Phase 0: trailing assistant is no longer trimmed — provider
            // validation will move to ProviderMessageAdapter in Phase 2.
            const messages = await log.fold('main');
            expect(messages).toHaveLength(3); // Q1, A1, A2 (T3 deleted, no trim)
            expect(messages[0]).toEqual({ role: 'user', content: 'Q1' });
            expect(messages[1]).toEqual({ role: 'assistant', content: 'A1' });
            expect(messages[2]).toEqual({ role: 'assistant', content: 'A2' });

            // Verify SessionState cascade
            const state = new SessionState(nodeId, sessionId);
            for (const tId of [t1Id, t2Id, t3Id, t4Id]) {
                const t = await log.readRound(tId);
                if (t && !t._deleted) state.loadFromProjection(roundToProjection(t, tId));
            }
            const cascadeIds = getCascadeRoundIds(state, t3Id);
            expect(cascadeIds).toContain(t3Id);
            expect(cascadeIds).toContain(t4Id);
        });
    });

    describe('delete assistant round → keep user', () => {
        it('should keep the user round visible after deleting assistant', async () => {
            const t1Id = await log.append('main', makeRound({ payload: makeUserPayload('Q1') }));
            const t2Id = await log.append('main', makeRound({
                parents: [t1Id],
                payload: makeAssistantPayload('A1'),
            }));

            await log.deleteRound(t2Id);

            const messages = await log.fold('main');
            expect(messages).toHaveLength(1);
            expect(messages[0]).toEqual({ role: 'user', content: 'Q1' });

            // T1 should NOT be marked _deleted
            const t1 = await log.readRound(t1Id);
            expect(t1).not.toBeNull();
            expect(t1!._deleted).toBeFalsy();

            // T2 should be marked _deleted
            const t2 = await log.readRound(t2Id);
            expect(t2!._deleted).toBe(true);
        });
    });

    describe('resend (clearAssistantInRound) → no new branch', () => {
        it('should clear assistant without creating a new branch', async () => {
            const t1Id = await log.append('main', makeRound({ payload: makeUserPayload('Q1') }));
            const t2Id = await log.append('main', makeRound({
                parents: [t1Id],
                payload: [
                    { role: 'user', content: 'Q1' },
                    { role: 'assistant', content: 'A1' },
                ],
            }));

            await log.clearAssistantInRound(t2Id);

            // fold should show Q1 from both T1 and T2 user message
            const messages = await log.fold('main');
            expect(messages).toHaveLength(2);
            expect(messages[0]).toEqual({ role: 'user', content: 'Q1' });
            expect(messages[1]).toEqual({ role: 'user', content: 'Q1' });

            // T2 should have no assistant payload
            const t2 = await log.readRound(t2Id);
            expect(t2!.payload.find(m => m.role === 'assistant')).toBeUndefined();
            expect(t2!.result).toBeUndefined();

            // Manifest branches should be unchanged
            const manifest = await log.loadManifest();
            const branchCount = Object.keys(manifest.branches).length;
            expect(branchCount).toBe(1); // only 'main'
        });
    });

    // ── Children reverse index ────────────────────────────────────────────

    describe('children reverse index', () => {
        it('should maintain children index across append operations', async () => {
            const t1Id = await log.append('main', makeRound({ payload: makeUserPayload('Q1') }));
            const t2Id = await log.append('main', makeRound({
                parents: [t1Id],
                payload: makeAssistantPayload('A1'),
            }));

            const manifest = await log.loadManifest();
            expect(manifest.children[t1Id]).toBeDefined();
            expect(manifest.children[t1Id]).toContain(t2Id);
        });

        it('should support O(1) sibling lookup via children index', async () => {
            const t1Id = await log.append('main', makeRound({ payload: makeUserPayload('Q1') }));
            const t2aId = await log.append('main', makeRound({
                parents: [t1Id],
                payload: makeAssistantPayload('A1-v1'),
            }));

            // Simulate regenerate: another assistant under the same parent
            const t2bId = await log.append('main', makeRound({
                id: 'sibling-round-id',
                parents: [t1Id],
                payload: makeAssistantPayload('A1-v2'),
            }));

            const manifest = await log.loadManifest();
            const siblings = manifest.children[t1Id] ?? [];
            expect(siblings.length).toBeGreaterThanOrEqual(2);
            expect(siblings).toContain(t2aId);
            expect(siblings).toContain(t2bId);
        });
    });

    it('keeps content containment separate from lineage children', async () => {
        const root = makeRound({ id: 'interaction', parents: [], kind: 'interaction', payload: [{ role: 'user', content: 'top' }] });
        await log.append('main', root);
        const child = makeRound({ id: 'agent-child', parents: ['interaction'], containerRoundId: 'interaction', kind: 'agent', payload: [{ role: 'assistant', content: 'child' }] });
        await log.append('main', child);
        const manifest = await log.loadManifest();
        expect(manifest.children.interaction).toContain('agent-child');
        expect(manifest.containmentChildren?.interaction).toContain('agent-child');
        expect((await log.listContainmentChildren('interaction'))).toEqual(['agent-child']);
    });

    it('applies branch context profile rules to fold()', async () => {
        await log.append('main', makeRound({
            id: 'context-r1', parents: [],
            payload: [{ role: 'user', content: 'exclude me' }, { role: 'assistant', content: 'old answer' }],
        }));
        await log.append('main', makeRound({
            id: 'context-r2', parents: ['context-r1'],
            payload: [{ role: 'user', content: 'keep me' }, { role: 'assistant', content: 'new answer' }],
        }));

        await log.setRoundContextRules('main', ['context-r1'], 'exclude');
        expect((await log.fold('main')).map(message => message.content)).toEqual(['keep me', 'new answer']);

        await log.setRoundContextRules('main', ['context-r1'], 'include');
        expect((await log.fold('main')).map(message => message.content)).toEqual([
            'exclude me', 'old answer', 'keep me', 'new answer',
        ]);
    });

    // ── Soft-delete filtering in fold ─────────────────────────────────────

    describe('soft-delete filtering', () => {
        it('fold() should skip _deleted rounds', async () => {
            const t1Id = await log.append('main', makeRound({ payload: makeUserPayload('Q1') }));
            const t2Id = await log.append('main', makeRound({
                parents: [t1Id],
                payload: makeAssistantPayload('A1'),
            }));

            await log.deleteRound(t2Id);

            const messages = await log.fold('main');
            const deletedRoundIds = (await Promise.all(
                [t1Id, t2Id].map(id => log.readRound(id)),
            )).filter(t => t?._deleted).map(t => t!.id);

            expect(deletedRoundIds).toContain(t2Id);
            expect(deletedRoundIds).not.toContain(t1Id);
        });
    });

    // ── Event emission ────────────────────────────────────────────────────

    describe('event emission', () => {
        it('should emit round:appended on append', async () => {
            await log.append('main', makeRound({ payload: makeUserPayload('Q1') }));

            expect(events.length).toBeGreaterThanOrEqual(1);
            expect(events[0].type).toBe('round:appended');
            expect((events[0] as any).projection).toBeDefined();
        });

        it('should emit round:updated on clearAssistantInRound', async () => {
            const t1Id = await log.append('main', makeRound({ payload: [
                { role: 'user', content: 'Q1' },
                { role: 'assistant', content: 'A1' },
            ]}));

            const beforeCount = events.length;
            await log.clearAssistantInRound(t1Id);

            const newEvents = events.slice(beforeCount);
            expect(newEvents.length).toBeGreaterThanOrEqual(1);
            expect(newEvents[0].type).toBe('round:updated');
        });

        it('should emit round:updated on markStale', async () => {
            const t1Id = await log.append('main', makeRound({ payload: makeUserPayload('Q1') }));

            const beforeCount = events.length;
            await log.markStale(t1Id);

            const newEvents = events.slice(beforeCount);
            expect(newEvents.length).toBeGreaterThanOrEqual(1);
            expect(newEvents[0].type).toBe('round:updated');
            expect((newEvents[0] as any).changes.stale).toBe(true);
        });

        it('should emit round:deleted on deleteRound', async () => {
            const t1Id = await log.append('main', makeRound({ payload: makeUserPayload('Q1') }));

            const beforeCount = events.length;
            await log.deleteRound(t1Id);

            const newEvents = events.slice(beforeCount);
            expect(newEvents.length).toBeGreaterThanOrEqual(1);
            expect(newEvents[0].type).toBe('round:deleted');
        });
    });

    // ── Fold cache ────────────────────────────────────────────────────────

    describe('fold caching', () => {
        it('should invalidate cache on append', async () => {
            const t1Id = await log.append('main', makeRound({ payload: makeUserPayload('Q1') }));
            const first = await log.fold('main'); // populate cache
            await log.append('main', makeRound({
                parents: [t1Id],
                payload: makeUserPayload('Q2'),
            }));

            const second = await log.fold('main');
            expect(second.length).toBeGreaterThan(first.length);
        });

        it('should invalidate cache on delete', async () => {
            const t1Id = await log.append('main', makeRound({ payload: makeUserPayload('Q1') }));
            await log.fold('main'); // populate cache
            await log.deleteRound(t1Id);

            const messages = await log.fold('main');
            expect(messages).toHaveLength(0);
        });
    });

    // ── Manifest read/write ──────────────────────────────────────────────

    describe('manifest management', () => {
        it('should bootstrap manifest on first access', async () => {
            engine.setManifest({}); // empty manifest
            const freshLog = new RoundLog(engine as unknown as IChatEngine, nodeId, sessionId);

            const manifest = await freshLog.loadManifest();
            // RoundManifest has no format field;
            expect(manifest.branches.main).toBeDefined();
        });

        it('should persist children index in manifest', async () => {
            const t1Id = await log.append('main', makeRound({ payload: makeUserPayload('Q1') }));
            await log.append('main', makeRound({
                parents: [t1Id],
                payload: makeAssistantPayload('A1'),
            }));

            const manifest = await log.loadManifest();
            expect(manifest.children).toBeDefined();
            const children = manifest.children[t1Id] ?? [];
            expect(children.length).toBeGreaterThanOrEqual(1);
        });
    });

    // ── Read/write turn files ─────────────────────────────────────────────

    describe('readRound / writeRound', () => {
        it('should persist and read back round data', async () => {
            const roundId = await log.append('main', makeRound({
                payload: makeUserPayload('Hello World'),
            }));

            const persisted = await log.readRound(roundId);
            expect(persisted).not.toBeNull();
            expect(persisted!.payload[0].content).toBe('Hello World');
        });

        it('should return null for non-existent round', async () => {
            const result = await log.readRound('non-existent-id');
            expect(result).toBeNull();
        });
    });
});

// ── SessionState projection tests ──────────────────────────────────────────

describe('SessionState (round format)', () => {
    it('should cascade delete children via collectCascadeRoundIds', () => {
        const state = new SessionState('node', 'session');

        const p1: RoundProjection = { roundId: 't1', parents: [], kind: 'chat', userMessage: { content: 'Q1', persistedNodeId: 't1' }, meta: { createdAt: 1, origin: 'user' } };
        const p2: RoundProjection = { roundId: 't2', parents: ['t1'], kind: 'chat', assistantMessage: { content: 'A1', status: 'success', persistedNodeId: 't2' }, meta: { createdAt: 2, origin: 'user' } };
        const p3: RoundProjection = { roundId: 't3', parents: ['t2'], kind: 'chat', userMessage: { content: 'Q2', persistedNodeId: 't3' }, meta: { createdAt: 3, origin: 'user' } };
        const p4: RoundProjection = { roundId: 't4', parents: ['t3'], kind: 'chat', assistantMessage: { content: 'A2', status: 'success', persistedNodeId: 't4' }, meta: { createdAt: 4, origin: 'user' } };

        for (const p of [p1, p2, p3, p4]) state.loadFromProjection(p);

        const cascadeIds = getCascadeRoundIds(state, 't3');
        expect(cascadeIds).toContain('t3');
        expect(cascadeIds).toContain('t4');
        expect(cascadeIds).not.toContain('t1');
        expect(cascadeIds).not.toContain('t2');
    });

    it('should apply round:appended event', () => {
        const state = new SessionState('node', 'session');

        const events = state.apply({
            type: 'round:appended',
            ref: 'main',
            roundId: 't1',
            projection: {
                roundId: 't1', parents: [], kind: 'chat',
                userMessage: { content: 'Hello', persistedNodeId: 't1' },
                meta: { createdAt: 1, origin: 'user' },
            },
        });

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('message:appended');
    });
});

// ── Helper ─────────────────────────────────────────────────────────────────

/** Access the private collectCascadeRoundIds via apply("round:deleted"). */
function getCascadeRoundIds(state: SessionState, roundId: string): string[] {
    const events = state.apply({ type: 'round:deleted', roundId });
    const deletedEvent = events.find(e => e.type === 'messages:deleted');
    if (deletedEvent && 'payload' in deletedEvent) {
        return (deletedEvent.payload as { deletedIds: string[] }).deletedIds;
    }
    return [];
}
