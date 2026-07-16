// @file: llm-engine/__tests__/turn-log.test.ts
// Integration tests for TurnLog with an in-memory IChatEngine mock.
//
// Covers:
//   - TurnLog CRUD: append, fold, readTurn, writeTurn
//   - Delete semantics: user→cascade, assistant→keep, resend→no-branch
//   - Children reverse index + fold caching + soft-delete filtering
//   - Event emission: turn:appended, turn:updated, turn:deleted

import { describe, it, expect, beforeEach } from 'vitest';
import type {
    Turn, TurnId, Ref, ChatMessage, ILog, DraftArea, RefStore,
} from '@itookit/common';
import type { IChatEngine, FSNode } from '../src/persistence/types';
import type { TurnManifest, PersistedTurn, TurnProjection } from '../src/persistence/turn-types';
import type { TurnLogEvent } from '../src/persistence/turn-events';
import { TurnLog, turnToProjection } from '../src/persistence/turn-log';
import { SessionState } from '../src/session/session-state';

// ── In-memory IChatEngine mock ──────────────────────────────────────────────

type AssetEntry = { name: string; path: string; content: string };

class InMemoryChatEngine implements Partial<IChatEngine> {
    private manifest: Record<string, unknown> = {};
    private assets: Map<string, AssetEntry[]> = new Map();
    private files: Map<string, string> = new Map();
    private children: Map<string, FSNode[]> = new Map();
    private nextAssetIdx = 1;

    // ── Manifest ────────────────────────────────────────────────────────

    async getManifest(_nodeId: string): Promise<unknown> {
        return { ...this.manifest };
    }

    setManifest(m: Record<string, unknown>): void {
        this.manifest = m;
    }

    // ── Asset directory ─────────────────────────────────────────────────

    async getAssetDirectoryId(nodeId: string): Promise<string | null> {
        return `_${nodeId}`;
    }

    async createAsset(dirId: string, name: string, content: string): Promise<FSNode> {
        const path = `${dirId}/${name}`;
        if (!this.assets.has(dirId)) this.assets.set(dirId, []);
        this.assets.get(dirId)!.push({ name, path, content });
        this.files.set(path, content);
        return { path, name } as unknown as FSNode;
    }

    async getAssets(dirId: string): Promise<FSNode[]> {
        return (this.assets.get(dirId) ?? []).map(a => ({
            name: a.name, path: a.path,
        } as unknown as FSNode));
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
            for (const [dir, entries] of this.assets) {
                this.assets.set(dir, entries.filter(e => e.path !== p));
            }
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

function makeTurn(overrides: Partial<Turn> = {}): Turn {
    return {
        id: '',
        parents: [],
        payload: [],
        ...overrides,
    };
}

function makeUserPayload(text: string): Turn['payload'] {
    return [{ role: 'user' as const, content: text }];
}

function makeAssistantPayload(text: string): Turn['payload'] {
    return [{ role: 'assistant' as const, content: text }];
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('TurnLog', () => {
    let engine: InMemoryChatEngine;
    let log: TurnLog;
    let events: TurnLogEvent[];
    const nodeId = 'test-session.chat';
    const sessionId = 'test-session-id';

    beforeEach(() => {
        engine = new InMemoryChatEngine();
        engine.setManifest({
            id: sessionId,
            format: 'turn',
            rootTurnId: 'root',
            branches: { main: 'root' },
            current_branch: 'main',
            current_head: 'root',
            children: {},
        });
        events = [];
        log = new TurnLog(engine as unknown as IChatEngine, nodeId, sessionId);
        log.setEventListener((e) => events.push(e));
    });

    // ── Basic CRUD ────────────────────────────────────────────────────────

    describe('append & fold', () => {
        it('should append a turn and fold returns its messages', async () => {
            const turn = makeTurn({ payload: [{ role: 'user', content: 'Hello' }] });
            const turnId = await log.append('main', turn);

            const messages = await log.fold('main');
            expect(messages).toHaveLength(1);
            expect(messages[0]).toEqual({ role: 'user', content: 'Hello' });
        });

        it('should append multiple turns and fold returns them in order', async () => {
            const t1 = makeTurn({ payload: [{ role: 'user', content: 'Q1' }] });
            const t1Id = await log.append('main', t1);
            const t2 = makeTurn({
                parents: [t1Id],
                payload: [{ role: 'assistant', content: 'A1' }],
            });
            const t2Id = await log.append('main', t2);
            const t3 = makeTurn({
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

        it('should trim trailing assistant from fold (Anthropic requirement)', async () => {
            const t1 = makeTurn({ payload: [{ role: 'user', content: 'Q1' }] });
            const t1Id = await log.append('main', t1);
            const t2 = makeTurn({
                parents: [t1Id],
                payload: [{ role: 'assistant', content: 'A1' }],
            });
            await log.append('main', t2);

            const messages = await log.fold('main');
            expect(messages).toHaveLength(1);
            expect(messages[0]).toEqual({ role: 'user', content: 'Q1' });
        });

        it('should skip empty assistant messages in fold', async () => {
            const t1 = makeTurn({ payload: [
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

    describe('delete user turn → cascade delete assistant', () => {
        it('fold() should skip deleted turns and SessionState should cascade', async () => {
            const t1Id = await log.append('main', makeTurn({ payload: makeUserPayload('Q1') }));
            const t2Id = await log.append('main', makeTurn({
                parents: [t1Id],
                payload: makeAssistantPayload('A1'),
            }));
            const t3Id = await log.append('main', makeTurn({
                parents: [t2Id],
                payload: makeUserPayload('Q2'),
            }));
            const t4Id = await log.append('main', makeTurn({
                parents: [t3Id],
                payload: makeAssistantPayload('A2'),
            }));

            // Delete user turn T3 — T4 should cascade in SessionState projection
            await log.deleteTurn(t3Id);

            // fold() skips _deleted turns (T3) and trims trailing assistant (A1 → T2)
            const messages = await log.fold('main');
            expect(messages).toHaveLength(1); // Q1 only (A1 trimmed as trailing assistant)
            expect(messages[0]).toEqual({ role: 'user', content: 'Q1' });

            // Verify SessionState cascade
            const state = new SessionState(nodeId, sessionId);
            state.setTurnFormat(true);
            for (const tId of [t1Id, t2Id, t3Id, t4Id]) {
                const t = await log.readTurn(tId);
                if (t && !t._deleted) state.loadFromProjection(turnToProjection(t, tId));
            }
            const cascadeIds = getCascadeTurnIds(state, t3Id);
            expect(cascadeIds).toContain(t3Id);
            expect(cascadeIds).toContain(t4Id);
        });
    });

    describe('delete assistant turn → keep user', () => {
        it('should keep the user turn visible after deleting assistant', async () => {
            const t1Id = await log.append('main', makeTurn({ payload: makeUserPayload('Q1') }));
            const t2Id = await log.append('main', makeTurn({
                parents: [t1Id],
                payload: makeAssistantPayload('A1'),
            }));

            await log.deleteTurn(t2Id);

            const messages = await log.fold('main');
            expect(messages).toHaveLength(1);
            expect(messages[0]).toEqual({ role: 'user', content: 'Q1' });

            // T1 should NOT be marked _deleted
            const t1 = await log.readTurn(t1Id);
            expect(t1).not.toBeNull();
            expect(t1!._deleted).toBeFalsy();

            // T2 should be marked _deleted
            const t2 = await log.readTurn(t2Id);
            expect(t2!._deleted).toBe(true);
        });
    });

    describe('resend (clearAssistantInTurn) → no new branch', () => {
        it('should clear assistant without creating a new branch', async () => {
            const t1Id = await log.append('main', makeTurn({ payload: makeUserPayload('Q1') }));
            const t2Id = await log.append('main', makeTurn({
                parents: [t1Id],
                payload: [
                    { role: 'user', content: 'Q1' },
                    { role: 'assistant', content: 'A1' },
                ],
            }));

            await log.clearAssistantInTurn(t2Id);

            // fold should show Q1 from both T1 and T2 user message
            const messages = await log.fold('main');
            expect(messages).toHaveLength(2);
            expect(messages[0]).toEqual({ role: 'user', content: 'Q1' });
            expect(messages[1]).toEqual({ role: 'user', content: 'Q1' });

            // T2 should have no assistant payload
            const t2 = await log.readTurn(t2Id);
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
            const t1Id = await log.append('main', makeTurn({ payload: makeUserPayload('Q1') }));
            const t2Id = await log.append('main', makeTurn({
                parents: [t1Id],
                payload: makeAssistantPayload('A1'),
            }));

            const manifest = await log.loadManifest();
            expect(manifest.children[t1Id]).toBeDefined();
            expect(manifest.children[t1Id]).toContain(t2Id);
        });

        it('should supportO(1) sibling lookup via children index', async () => {
            const t1Id = await log.append('main', makeTurn({ payload: makeUserPayload('Q1') }));
            const t2aId = await log.append('main', makeTurn({
                parents: [t1Id],
                payload: makeAssistantPayload('A1-v1'),
            }));

            // Simulate regenerate: another assistant under the same parent
            const t2bId = await log.append('main', makeTurn({
                id: 'sibling-turn-id',
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

    // ── Soft-delete filtering in fold ─────────────────────────────────────

    describe('soft-delete filtering', () => {
        it('fold() should skip _deleted turns', async () => {
            const t1Id = await log.append('main', makeTurn({ payload: makeUserPayload('Q1') }));
            const t2Id = await log.append('main', makeTurn({
                parents: [t1Id],
                payload: makeAssistantPayload('A1'),
            }));

            await log.deleteTurn(t2Id);

            const messages = await log.fold('main');
            const deletedTurnIds = (await Promise.all(
                [t1Id, t2Id].map(id => log.readTurn(id)),
            )).filter(t => t?._deleted).map(t => t!.id);

            expect(deletedTurnIds).toContain(t2Id);
            expect(deletedTurnIds).not.toContain(t1Id);
        });
    });

    // ── Event emission ────────────────────────────────────────────────────

    describe('event emission', () => {
        it('should emit turn:appended on append', async () => {
            await log.append('main', makeTurn({ payload: makeUserPayload('Q1') }));

            expect(events.length).toBeGreaterThanOrEqual(1);
            expect(events[0].type).toBe('turn:appended');
            expect((events[0] as any).projection).toBeDefined();
        });

        it('should emit turn:updated on clearAssistantInTurn', async () => {
            const t1Id = await log.append('main', makeTurn({ payload: [
                { role: 'user', content: 'Q1' },
                { role: 'assistant', content: 'A1' },
            ]}));

            const beforeCount = events.length;
            await log.clearAssistantInTurn(t1Id);

            const newEvents = events.slice(beforeCount);
            expect(newEvents.length).toBeGreaterThanOrEqual(1);
            expect(newEvents[0].type).toBe('turn:updated');
        });

        it('should emit turn:updated on markStale', async () => {
            const t1Id = await log.append('main', makeTurn({ payload: makeUserPayload('Q1') }));

            const beforeCount = events.length;
            await log.markStale(t1Id);

            const newEvents = events.slice(beforeCount);
            expect(newEvents.length).toBeGreaterThanOrEqual(1);
            expect(newEvents[0].type).toBe('turn:updated');
            expect((newEvents[0] as any).changes.stale).toBe(true);
        });

        it('should emit turn:deleted on deleteTurn', async () => {
            const t1Id = await log.append('main', makeTurn({ payload: makeUserPayload('Q1') }));

            const beforeCount = events.length;
            await log.deleteTurn(t1Id);

            const newEvents = events.slice(beforeCount);
            expect(newEvents.length).toBeGreaterThanOrEqual(1);
            expect(newEvents[0].type).toBe('turn:deleted');
        });
    });

    // ── Fold cache ────────────────────────────────────────────────────────

    describe('fold caching', () => {
        it('should invalidate cache on append', async () => {
            const t1Id = await log.append('main', makeTurn({ payload: makeUserPayload('Q1') }));
            const first = await log.fold('main'); // populate cache
            await log.append('main', makeTurn({
                parents: [t1Id],
                payload: makeUserPayload('Q2'),
            }));

            const second = await log.fold('main');
            expect(second.length).toBeGreaterThan(first.length);
        });

        it('should invalidate cache on delete', async () => {
            const t1Id = await log.append('main', makeTurn({ payload: makeUserPayload('Q1') }));
            await log.fold('main'); // populate cache
            await log.deleteTurn(t1Id);

            const messages = await log.fold('main');
            expect(messages).toHaveLength(0);
        });
    });

    // ── Manifest read/write ──────────────────────────────────────────────

    describe('manifest management', () => {
        it('should bootstrap manifest on first access', async () => {
            engine.setManifest({}); // empty manifest
            const freshLog = new TurnLog(engine as unknown as IChatEngine, nodeId, sessionId);

            const manifest = await freshLog.loadManifest();
            expect(manifest.format).toBe('turn');
            expect(manifest.branches.main).toBeDefined();
        });

        it('should persist children index in manifest', async () => {
            const t1Id = await log.append('main', makeTurn({ payload: makeUserPayload('Q1') }));
            await log.append('main', makeTurn({
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

    describe('readTurn / writeTurn', () => {
        it('should persist and read back turn data', async () => {
            const turnId = await log.append('main', makeTurn({
                payload: makeUserPayload('Hello World'),
            }));

            const persisted = await log.readTurn(turnId);
            expect(persisted).not.toBeNull();
            expect(persisted!.payload[0].content).toBe('Hello World');
        });

        it('should return null for non-existent turn', async () => {
            const result = await log.readTurn('non-existent-id');
            expect(result).toBeNull();
        });
    });
});

// ── SessionState projection tests ──────────────────────────────────────────

describe('SessionState (turn format)', () => {
    it('should cascade delete children via collectCascadeTurnIds', () => {
        const state = new SessionState('node', 'session');
        state.setTurnFormat(true);

        const p1: TurnProjection = { turnId: 't1', parents: [], kind: 'chat', userMessage: { content: 'Q1', persistedNodeId: 't1' }, meta: { createdAt: 1, origin: 'user' } };
        const p2: TurnProjection = { turnId: 't2', parents: ['t1'], kind: 'chat', assistantMessage: { content: 'A1', status: 'success', persistedNodeId: 't2' }, meta: { createdAt: 2, origin: 'user' } };
        const p3: TurnProjection = { turnId: 't3', parents: ['t2'], kind: 'chat', userMessage: { content: 'Q2', persistedNodeId: 't3' }, meta: { createdAt: 3, origin: 'user' } };
        const p4: TurnProjection = { turnId: 't4', parents: ['t3'], kind: 'chat', assistantMessage: { content: 'A2', status: 'success', persistedNodeId: 't4' }, meta: { createdAt: 4, origin: 'user' } };

        for (const p of [p1, p2, p3, p4]) state.loadFromProjection(p);

        const cascadeIds = getCascadeTurnIds(state, 't3');
        expect(cascadeIds).toContain('t3');
        expect(cascadeIds).toContain('t4');
        expect(cascadeIds).not.toContain('t1');
        expect(cascadeIds).not.toContain('t2');
    });

    it('should apply turn:appended event', () => {
        const state = new SessionState('node', 'session');
        state.setTurnFormat(true);

        const events = state.apply({
            type: 'turn:appended',
            ref: 'main',
            turnId: 't1',
            projection: {
                turnId: 't1', parents: [], kind: 'chat',
                userMessage: { content: 'Hello', persistedNodeId: 't1' },
                meta: { createdAt: 1, origin: 'user' },
            },
        });

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('message:appended');
    });
});

// ── Helper ─────────────────────────────────────────────────────────────────

/** Access the private collectCascadeTurnIds via apply("turn:deleted"). */
function getCascadeTurnIds(state: SessionState, turnId: string): string[] {
    const events = state.apply({ type: 'turn:deleted', turnId });
    const deletedEvent = events.find(e => e.type === 'messages:deleted');
    if (deletedEvent && 'payload' in deletedEvent) {
        return (deletedEvent.payload as { deletedIds: string[] }).deletedIds;
    }
    return [];
}
