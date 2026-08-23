// @file: durable-kernel/src/infrastructure/seqfile/seqfile-core.ts
// SeqFile 基础设施原语：目录/文件布局、路径/键名、编码、事务、事件追加。
// 供 store.ts 与 store-helpers.ts 复用，消除单一巨型辅助文件。

import type { IModuleFS, ISeqFileOperations, ISeqFileTransaction } from '@itookit/vfs-core';
import type { EventEnvelope, ResolvedStorageBinding } from '../../domain/types';

export function join(...parts: string[]): string {
    return `/${parts.flatMap(part => part.split('/')).filter(Boolean).join('/')}`;
}

export function encode(value: unknown): string {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('Value is not JSON serializable');
    return encoded;
}

export function decode<T = any>(value: string): T { return JSON.parse(value) as T; }

export function createId(prefix: string): string { return `${prefix}_${globalThis.crypto.randomUUID()}`; }

// ── 路径 / 键名 ───────────────────────────────────────────────────────────────

export function catalogPath(root: string): string { return join(root, 'catalog.seq'); }
export function sessionPath(root: string): string { return join(root, 'session.seq'); }
export function sharedPath(root: string): string { return join(root, 'shared.seq'); }
export function contextPath(root: string): string { return join(root, 'context.seq'); }
export function messagesPath(root: string): string { return join(root, 'messages.seq'); }
export function resourcesPath(root: string): string { return join(root, 'resources.seq'); }
export function eventsPath(root: string): string { return join(root, 'events.seq'); }
export function indexPath(root: string): string { return join(root, 'index.seq'); }
export function graphPath(root: string): string { return join(root, 'graph.seq'); }
export function taskPath(root: string, id: string): string { return join(root, 'tasks', id, 'task.seq'); }
export function attemptKey(id: string): string { return `attempt/${id}`; }
export function snapshotKey(version: number): string { return `snapshot/${String(version).padStart(16, '0')}`; }
export function taskWaitKey(targetId: string, waiterId: string): string {
    return `wait/task/${targetId}/${waiterId}`;
}
export function spawnMappingKey(parentId: string, key: string): string {
    return `spawn/${parentId}/${encodeURIComponent(key)}`;
}
export function outboxKey(id: string): string { return `outbox/${id}`; }
export function inboxKey(id: string): string { return `inbox/${id}`; }
export function sharedKey(key: string): string { return `value/${encodeURIComponent(key)}`; }
export function sharedHeadKey(key: string): string { return `head/${encodeURIComponent(key)}`; }
export function sharedHistoryPrefix(key: string): string { return `history/${encodeURIComponent(key)}/`; }
export function contextCommitKey(id: string): string { return `commit/${id}`; }
export function contextBranchKey(name: string): string { return `branch/${encodeURIComponent(name)}`; }
export function resourceKey(id: string): string { return `resource/${id}`; }
export function handleKey(id: string): string { return `handle/${id}`; }
export function budgetKey(resourceId: string, dimension: string): string {
    return `budget/${resourceId}/${encodeURIComponent(dimension)}`;
}
export function workspaceSnapshotKey(id: string): string { return `workspace/snapshot/${id}`; }
export function workspaceDiffKey(id: string): string { return `workspace/diff/${id}`; }

// ── 布局 / 事务 ───────────────────────────────────────────────────────────────

export async function ensureSessionLayout(binding: ResolvedStorageBinding): Promise<void> {
    requireTransactionalSeq(binding.fs);
    await ensureTree(binding.fs, binding.rootPath);
    for (const file of ['session.seq', 'shared.seq', 'context.seq', 'messages.seq', 'events.seq', 'graph.seq', 'resources.seq', 'index.seq']) {
        await ensureSeqFile(binding.fs, join(binding.rootPath, file));
    }
    await ensureTree(binding.fs, join(binding.rootPath, 'tasks'));
}

export async function ensureTaskLayout(binding: ResolvedStorageBinding, taskId: string): Promise<void> {
    const root = join(binding.rootPath, 'tasks', taskId);
    await ensureTree(binding.fs, root);
    await ensureTree(binding.fs, join(root, 'artifacts'));
    await ensureSeqFile(binding.fs, join(root, 'task.seq'));
}

export async function ensureTree(fs: IModuleFS, path: string): Promise<void> {
    let current = '';
    for (const part of path.split('/').filter(Boolean)) {
        const parent = current || null;
        current = `${current}/${part}`;
        if (!(await fs.driver.exists(current))) await fs.driver.createDirectory({ name: part, parentPath: parent });
    }
}

export async function ensureSeqFile(fs: IModuleFS, path: string): Promise<void> {
    if (await fs.driver.exists(path)) return;
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) throw new Error(`Invalid SeqFile path: ${path}`);
    const parentPath = parts.length ? `/${parts.join('/')}` : null;
    await fs.driver.createFile({ name, parentPath, type: 'seqfile', content: '' });
}

export function requireTransactionalSeq(fs: IModuleFS): ISeqFileOperations {
    const operations = fs.meta.seq;
    if (!operations?.transaction) throw new Error(`Module ${fs.moduleId} lacks transactional SeqFile support`);
    return operations;
}

export function seq(fs: IModuleFS): ISeqFileOperations {
    if (!fs.meta.seq) throw new Error(`Module ${fs.moduleId} lacks SeqFile support`);
    return fs.meta.seq;
}

export function transaction<T>(fs: IModuleFS, operation: (tx: ISeqFileTransaction) => Promise<T>): Promise<T> {
    return requireTransactionalSeq(fs).transaction!(operation);
}

export async function appendEventTx(
    tx: ISeqFileTransaction,
    root: string,
    sessionId: string,
    taskId: string | undefined,
    type: string,
    payload?: unknown,
): Promise<number> {
    const sequence = await tx.increment(eventsPath(root), 'next-sequence');
    const event: EventEnvelope = { sequence, sessionId, taskId, type, payload, occurredAt: Date.now() };
    await tx.setEntry(eventsPath(root), `event/${String(sequence).padStart(16, '0')}`, encode(event));
    return sequence;
}
