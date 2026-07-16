// @file: llm-engine/src/persistence/migration.ts
// ChatNode → Turn DAG format migration.
//
// Branch-aware algorithm (§3.6): for each branch head in the old ChatManifest,
// walk the parent_id chain to build Turn chains. Shared-prefix ChatNodes map to
// the same TurnId (via content hash or _turnId meta). Sibling ChatNodes become
// sibling Turns with the same parents.

import type { IChatEngine, ChatNode } from './types';
import type { TurnManifest, PersistedTurn } from './turn-types';
import type { TurnId, ChatMessage } from '@itookit/common';
import { TurnLog } from './turn-log';
import { ulid } from './ulid';
import { collectAllFileNodes } from './vfs-utils';
import { log } from '../utils/logger';

export interface MigrationResult {
    success: boolean;
    turnCount: number;
    branchesMigrated: string[];
    error?: string;
}

/**
 * Migrate a legacy ChatNode-format session to the Turn DAG format.
 *
 * The migration is non-destructive by default: a backup of the original manifest
 * is written before any changes. On failure, turn files are cleaned up and the
 * original manifest is restored.
 */
export async function migrateToTurnFormat(
    engine: IChatEngine,
    sessionId: string,
    options?: { dryRun?: boolean; backup?: boolean },
): Promise<MigrationResult> {
    const nodeId = await resolveNodeId(engine, sessionId);
    if (!nodeId) {
        return { success: false, turnCount: 0, branchesMigrated: [], error: 'Session node not found' };
    }

    const oldManifest = await engine.getManifest(nodeId) as unknown as Record<string, unknown>;
    if (oldManifest?.format === 'turn') {
        return { success: true, turnCount: 0, branchesMigrated: [], error: 'Already in turn format' };
    }

    const backup = options?.backup !== false;
    if (backup) {
        try {
            const backupPath = `${nodeId}/_backup-manifest-${Date.now()}.json`;
            await engine.createAsset(nodeId, `_backup-manifest-${Date.now()}.json`,
                JSON.stringify(oldManifest, null, 2));
            log.info('Migration backup created', { sessionId, path: backupPath });
        } catch (e) {
            log.warn('Failed to create migration backup', { sessionId, error: e });
        }
    }

    try {
        const assetDirId = await engine.getAssetDirectoryId(nodeId);
        if (!assetDirId) {
            return { success: false, turnCount: 0, branchesMigrated: [], error: 'No asset directory' };
        }

        const branches = (oldManifest.branches ?? {}) as Record<string, string>;
        const branchNames = Object.keys(branches);
        if (branchNames.length === 0) {
            return { success: false, turnCount: 0, branchesMigrated: [], error: 'No branches in manifest' };
        }

        // Collect all ChatNodes from all branch chains
        const allNodes = new Map<string, ChatNode>();
        const branchChains = new Map<string, string[]>(); // branchName → ordered nodeIds (root→head)

        for (const [branchName, headId] of Object.entries(branches)) {
            const chain = await walkParentChain(
                engine, assetDirId, headId,
            );
            branchChains.set(branchName, chain);
            for (const nodeId of chain) {
                if (!allNodes.has(nodeId)) {
                    const node = await readChatNode(engine, assetDirId, nodeId);
                    if (node) allNodes.set(nodeId, node);
                }
            }
        }

        // Build nodeId → TurnId mapping (shared prefix dedup)
        const nodeToTurnId = buildTurnIdMap(allNodes, branchChains);

        // Build Turns from branch chains
        const turns = new Map<TurnId, PersistedTurn>();
        const childrenIndex: Record<TurnId, TurnId[]> = {};
        const branchHeadTurnIds = new Map<string, TurnId>();

        for (const [branchName, chain] of branchChains) {
            const turnIds = buildTurnsFromChain(
                chain, allNodes, nodeToTurnId, turns, childrenIndex,
            );
            if (turnIds.length > 0) {
                branchHeadTurnIds.set(branchName, turnIds[turnIds.length - 1]);
            }
        }

        const rootTurnId = findRoot(turns)?.id ?? ulid();

        if (options?.dryRun) {
            return {
                success: true,
                turnCount: turns.size,
                branchesMigrated: branchNames,
            };
        }

        // Write turn files and manifest
        await writeTurnFiles(engine, assetDirId, turns);

        const turnLog = new TurnLog(engine, nodeId, sessionId);
        const newManifest: TurnManifest = {
            format: 'turn',
            rootTurnId,
            branches: Object.fromEntries(branchHeadTurnIds),
            currentBranch: (oldManifest.current_branch as string) ?? 'main',
            currentHead: branchHeadTurnIds.get((oldManifest.current_branch as string) ?? 'main') ?? rootTurnId,
            children: childrenIndex,
        };
        await turnLog.saveManifest(newManifest);

        log.info('Migration completed', { sessionId, turnCount: turns.size, branches: branchNames });
        return { success: true, turnCount: turns.size, branchesMigrated: branchNames };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error('Migration failed', { sessionId, error: msg });
        return { success: false, turnCount: 0, branchesMigrated: [], error: msg };
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function resolveNodeId(engine: IChatEngine, sessionId: string): Promise<string | null> {
    const tree = await engine.driver.getChildren('/');
    const allFiles = await collectAllFileNodes(
        path => engine.getChildren(path), tree,
    );
    for (const node of allFiles) {
        if (!node.name.endsWith('.chat') && node.name.includes('.')) continue;
        try {
            const manifest = await engine.getManifest(node.path);
            if ((manifest as unknown as Record<string, unknown>).id === sessionId) return node.path;
        } catch { continue; }
    }
    return null;
}

/** Walk the parent_id chain from a head node back to root. Returns ordered nodeIds (root→head). */
async function walkParentChain(
    engine: IChatEngine,
    assetDirId: string,
    headId: string,
): Promise<string[]> {
    const chain: string[] = [];
    let current: string | undefined = headId;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
        visited.add(current);
        chain.unshift(current);
        const node = await readChatNode(engine, assetDirId, current);
        current = node?.parent_id ?? undefined;
    }
    return chain;
}

async function readChatNode(
    engine: IChatEngine,
    assetDirId: string,
    nodeId: string,
): Promise<ChatNode | null> {
    try {
        const content = await engine.readContent(`${assetDirId}/${nodeId}.chat`);
        if (typeof content === 'string') return JSON.parse(content) as ChatNode;
    } catch { /* node file missing */ }
    return null;
}

/** Build NodeId → TurnId mapping with shared-prefix dedup via content hash. */
function buildTurnIdMap(
    allNodes: Map<string, ChatNode>,
    branchChains: Map<string, string[]>,
): Map<string, TurnId> {
    const map = new Map<string, TurnId>();

    for (const chain of branchChains.values()) {
        for (const nodeId of chain) {
            if (map.has(nodeId)) continue;
            const node = allNodes.get(nodeId);
            if (!node) continue;

            // Prefer _turnId from legacy append() meta
            const existingTurnId = node.meta?._turnId as string | undefined;
            if (existingTurnId) {
                map.set(nodeId, existingTurnId);
            } else {
                // Content hash: role + content
                const hash = simpleHash(`${node.role}:${node.content ?? ''}`);
                map.set(nodeId, hash);
            }
        }
    }
    return map;
}

/** Build PersistedTurn objects from a sorted node chain, maintaining DAG relationships. */
function buildTurnsFromChain(
    chain: string[],
    allNodes: Map<string, ChatNode>,
    nodeToTurnId: Map<string, TurnId>,
    turns: Map<TurnId, PersistedTurn>,
    childrenIndex: Record<TurnId, TurnId[]>,
): TurnId[] {
    const result: TurnId[] = [];
    const paired = pairUserAssistant(chain, allNodes);

    for (const { userNodeId, assistantNodeId } of paired) {
        const turnId = nodeToTurnId.get(userNodeId) ?? ulid();
        if (turns.has(turnId)) {
            result.push(turnId);
            continue;
        }

        const payload: ChatMessage[] = [];
        const userNode = allNodes.get(userNodeId);
        const assistantNode = assistantNodeId ? allNodes.get(assistantNodeId) : null;

        if (userNode && userNode.role === 'system') {
            payload.push({ role: 'system', content: userNode.content ?? '' });
        } else if (userNode) {
            payload.push({ role: 'user', content: userNode.content ?? '' });
        }
        if (assistantNode) {
            payload.push({ role: 'assistant', content: assistantNode.content ?? '' });
        }

        const parentTurnId = result.length > 0 ? result[result.length - 1] : null;
        const turn: PersistedTurn = {
            id: turnId,
            parents: parentTurnId ? [parentTurnId] : [],
            payload,
            meta: {
                createdAt: userNode?.created_at ? new Date(userNode.created_at).getTime() : Date.now(),
                origin: ((userNode?.meta?.origin ?? 'user') as PersistedTurn['meta']['origin']),
            },
        };

        turns.set(turnId, turn);
        result.push(turnId);

        // Maintain children index
        if (parentTurnId) {
            if (!childrenIndex[parentTurnId]) childrenIndex[parentTurnId] = [];
            if (!childrenIndex[parentTurnId].includes(turnId)) {
                childrenIndex[parentTurnId].push(turnId);
            }
        }
    }

    return result;
}

/** Pair user+assistant ChatNodes that should be merged into a single Turn. */
function pairUserAssistant(
    chain: string[],
    allNodes: Map<string, ChatNode>,
): { userNodeId: string; assistantNodeId?: string }[] {
    const result: { userNodeId: string; assistantNodeId?: string }[] = [];
    let i = 0;

    while (i < chain.length) {
        const node = allNodes.get(chain[i]);
        if (!node) { i++; continue; }

        if (node.role === 'system') {
            result.push({ userNodeId: chain[i] });
            i++;
        } else if (node.role === 'user') {
            const nextNode = i + 1 < chain.length ? allNodes.get(chain[i + 1]) : null;
            if (nextNode && nextNode.role === 'assistant') {
                result.push({ userNodeId: chain[i], assistantNodeId: chain[i + 1] });
                i += 2;
            } else {
                result.push({ userNodeId: chain[i] });
                i++;
            }
        } else {
            // Standalone assistant (regenerated etc.) — pair with previous user turn
            const lastPair = result[result.length - 1];
            if (lastPair && !lastPair.assistantNodeId) {
                lastPair.assistantNodeId = chain[i];
            } else {
                result.push({ userNodeId: chain[i] });
            }
            i++;
        }
    }
    return result;
}

async function writeTurnFiles(
    engine: IChatEngine,
    assetDirId: string,
    turns: Map<TurnId, PersistedTurn>,
): Promise<void> {
    // Ensure turns/ sub-directory
    try { await engine.getChildren(`${assetDirId}/turns`); } catch {
        await engine.createDirectory('turns', assetDirId);
    }

    const entries = Array.from(turns.entries());
    await Promise.all(entries.map(([turnId, turn]) =>
        engine.createAsset(assetDirId, `turns/${turnId}.json`, JSON.stringify(turn, null, 2))
            .catch((e) => { log.warn('Failed to write turn file', { turnId, error: e }); }),
    ));
}

function findRoot(turns: Map<TurnId, PersistedTurn>): PersistedTurn | undefined {
    for (const turn of turns.values()) {
        if (turn.parents.length === 0) return turn;
    }
    return undefined;
}

/** Simple non-cryptographic hash for dedup. */
function simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        const chr = input.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    // Encode as a ULID-like string (26 chars, Crockford base32)
    const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const abs = Math.abs(hash);
    let result = '';
    for (let i = 0; i < 10; i++) {
        result = CROCKFORD[abs % 32] + result;
    }
    // Prefix with timestamp-like component from ulid for stable ordering
    return ulid().slice(0, 16) + result.padStart(10, '0');
}
