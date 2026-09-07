import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend, type IVFSManager, type IFileSystem } from '@itookit/vfs-core';
import { Kernel } from './application/kernel';
import { SeqFileKernelStore } from './infrastructure/seqfile/store';
import { addEffect, executeEffectAdapter } from './application/effect-utils';
import { recoverWaitGraphTx } from './infrastructure/seqfile/store-helpers';
import { waitForChange } from './public/event-stream';
import type { ResolvedStorageBinding, TaskRecord, DurableTaskProgram } from './domain/types';

describe('durable harness protocols', () => {
    let manager: IVFSManager, fs: IFileSystem, binding: ResolvedStorageBinding;
    let store: SeqFileKernelStore, kernel: Kernel;
    const spec = { program: { kind: 'test', version: '1' }, input: null };
    beforeEach(async () => {
        ({ manager } = await createVFS({ rootBackend: new MemoryBackend(),}));
        fs = await manager.openFileSystem('/data/test');
        binding = { fs, rootPath: '/session' };
        store = new SeqFileKernelStore({ fs, rootPath: '/catalog' }, async () => binding);
        await store.initialize(); await store.createSession('s', { kind: 'test', locator: null });
        kernel = new Kernel({ catalog: { fs, rootPath: '/catalog' }, pollMs: 0, maxConcurrentEffects: 2 });
        kernel.registerStorageResolver({ kind: 'test', async resolve() { return binding; } });
        await kernel.initialize();
    });
    afterEach(async () => { kernel.dispose(); await kernel.waitIdle(); await manager.dispose(); });

    it('uses a deadline timer without polling and leaves idle sessions idle', async () => {
        kernel.registerProgram({
            manifest: { kind: 'timer-only', version: '1' },
            init() { return { state: null, next: { type: 'wait', on: { type: 'timer', id: 'due', at: Date.now() + 30 } } }; },
            reduce(state, event) {
                return event.type === 'timer-fired' ? { state, next: { type: 'complete', output: 'timer' } }
                    : { state, next: { type: 'continue' } };
            },
        });
        const session = await kernel.openSession('s');
        const task = await session.spawn({ program: { kind: 'timer-only', version: '1' }, input: null });
        expect((await task.wait({ timeoutMs: 1000 })).output).toBe('timer');
        await new Promise(resolve => setTimeout(resolve, 30));
        const sweep = vi.spyOn((kernel as any).store, 'sweep');
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(sweep).not.toHaveBeenCalled();
        sweep.mockRestore();
    });

    it('takes over an unexpired attempt and rejects its stale commit', async () => {
        const task = await store.createTask(binding, 's', spec);
        const claim = (await store.claimReady(binding, 'dead-process', 60_000))!;
        const paused = await store.createTask(binding, 's', { ...spec, deferStart: true });
        await store.controlTask(binding, paused.id, 'pause', { requestId: 'pause' });
        kernel.registerProgram({ manifest: spec.program,
            init() { return { state: null, next: { type: 'complete', output: 'recovered' } }; },
            reduce() { throw new Error('unexpected'); },
        });
        const report = await kernel.recoverSession('s', { takeover: true });
        expect(report.recoveredTasks).toBe(1);
        expect((await (await kernel.openTask(task.id)).wait({ timeoutMs: 1000 })).output).toBe('recovered');
        expect((await store.readTask(binding, paused.id)).control?.mode).toBe('pause');
        await expect(store.commitTask(binding, claim, { ...claim.task, status: 'succeeded' }, 'task.completed')).rejects.toThrow();
    });

    it('notifies task observers on an external SeqFile commit with polling disabled', async () => {
        const observer = new Kernel({ catalog: { fs, rootPath: '/catalog' }, pollMs: 0, maxConcurrent: 0 });
        observer.registerStorageResolver({ kind: 'test', async resolve() { return binding; } });
        await observer.initialize(); await observer.openSession('s');
        const task = await store.createTask(binding, 's', { ...spec, deferStart: true });
        let notified = false;
        const waiting = waitForChange(observer, 's', task.id, 1000).then(() => { notified = true; });
        try {
            await store.signalTask(binding, task.id, { type: 'external' });
            await Promise.resolve();
            expect(notified).toBe(true);
            await waiting;
        } finally { observer.dispose(); await observer.waitIdle(); }
    });

    it('persists retry progress for a missing session and a rejection when it closes', async () => {
        const source = await kernel.openSession('s');
        const message = await source.sendToSession('later', 'topic', null);
        expect(message.status).toBe('pending');
        const [retry] = await source.outbox();
        expect(retry.deliveryAttempts).toBeGreaterThanOrEqual(1);
        expect(retry.nextAttemptAt).toBeGreaterThan(retry.createdAt);
        const targetBinding = { fs, rootPath: '/later' };
        const targetStore = new SeqFileKernelStore({ fs, rootPath: '/catalog' }, async () => targetBinding);
        await targetStore.createSession('later', { kind: 'later', locator: null });
        kernel.registerStorageResolver({ kind: 'later', async resolve() { return targetBinding; } });
        await targetStore.setSessionStatus(targetBinding, 'closing');
        await targetStore.setSessionStatus(targetBinding, 'closed');
        expect(await kernel.relayPendingMessages()).toBe(0);
        expect((await source.outbox())[0].rejection?.code).toBe('target-closed');
        expect(await store.pendingOutbox(binding)).toEqual([]);
    });

    it('expires a message to a never-created session and allows the source to close', async () => {
        const source = await kernel.openSession('s');
        const rejected = await source.sendToSession('never-created', 'topic', null, { expiresAt: 0 });
        expect(rejected.status).toBe('rejected');
        expect(rejected.rejection?.code).toBe('expired');
        await kernel.closeSession('s', false);
        expect((await store.sessionRecord(binding)).status).toBe('closed');
    });

    it('preserves wait registrations newer than the recovery task snapshot', async () => {
        const target = await store.createTask(binding, 's', { ...spec, deferStart: true });
        const waiter = await store.createTask(binding, 's', spec);
        const claim = (await store.claimReady(binding, 'w', 10_000))!;
        await store.commitTask(binding, claim, { ...claim.task, status: 'waiting', currentAttempt: undefined,
            wait: { type: 'task', id: target.id } }, 'task.waiting');
        await fs.meta.seq!.transaction!(tx => recoverWaitGraphTx(tx, binding.rootPath, [target.id]));
        await store.cancelTask(binding, target.id);
        expect((await store.readTask(binding, waiter.id)).status).toBe('ready');
    });

    it('repairs lost wait and dependency indexes from durable records', async () => {
        const target = await store.createTask(binding, 's', { ...spec, deferStart: true });
        const dependent = await store.createTask(binding, 's', { ...spec, dependsOn: [{ task: target.id, condition: 'terminal' }] });
        const waiter = await store.createTask(binding, 's', spec);
        const claim = (await store.claimReady(binding, 'w', 10_000))!;
        expect(claim.task.id).toBe(waiter.id);
        await store.commitTask(binding, claim, { ...claim.task, status: 'waiting', currentAttempt: undefined,
            wait: { type: 'all', waits: [{ type: 'task', id: target.id }, { type: 'shared-version', key: 'a/b', afterVersion: 0 }] } }, 'task.waiting');
        await fs.meta.seq!.transaction!(async tx => {
            const keys: string[] = [];
            await tx.walkEntries('/session/graph.seq', row => { keys.push(row.key); return true; });
            for (const key of keys) await tx.deleteEntry('/session/graph.seq', key);
        });
        await store.cancelTask(binding, target.id);
        await store.setShared(binding, 'a/b', 'done');
        expect((await store.readTask(binding, waiter.id)).status).toBe('waiting');
        await store.recover(binding);
        expect((await store.readTask(binding, waiter.id)).status).toBe('ready');
        expect((await store.readTask(binding, dependent.id)).status).toBe('ready');
        const before = await store.readTask(binding, waiter.id);
        await store.recover(binding);
        expect((await store.readTask(binding, waiter.id)).pendingEvents).toEqual(before.pendingEvents);
    });

    it('keeps task exits observable when no waiter existed at completion', async () => {
        const target = await store.createTask(binding, 's', { ...spec, deferStart: true });
        await store.cancelTask(binding, target.id);
        const waiter = await store.createTask(binding, 's', spec);
        const claim = (await store.claimReady(binding, 'w', 10_000))!;
        const next = await store.commitTask(binding, claim, { ...claim.task, status: 'waiting', currentAttempt: undefined,
            wait: { type: 'task', id: target.id } }, 'task.waiting');
        expect(next.status).toBe('ready');
        expect(next.pendingEvents).toContainEqual(expect.objectContaining({ type: 'task-exited', taskId: target.id }));
        await expect(store.readTask(binding, '../escape')).rejects.toThrow('Invalid object ID');
    });

    it('cleans missing dependants without rolling back target completion', async () => {
        const target = await store.createTask(binding, 's', { ...spec, deferStart: true });
        await fs.meta.seq!.setEntry('/session/graph.seq', `edge/${target.id}/missing`, JSON.stringify({ task: target.id }));
        await fs.meta.seq!.setEntry('/session/graph.seq', `wait/task/${target.id}/missing`, '{}');
        await store.cancelTask(binding, target.id);
        expect((await store.readTask(binding, target.id)).status).toBe('cancelled');
        expect(await fs.meta.seq!.getEntry('/session/graph.seq', `edge/${target.id}/missing`)).toBeNull();
        expect(await fs.meta.seq!.getEntry('/session/graph.seq', `wait/task/${target.id}/missing`)).toBeNull();
    });

    it('protects the kernel layout from rename, ancestor moves and deletion', async () => {
        await expect(fs.driver.rename('/session', 'renamed')).rejects.toMatchObject({ code: 'EBUSY' });
        const task = await store.createTask(binding, 's', spec);
        await expect(fs.driver.rename(`/session/tasks/${task.id}`, 'changed')).rejects.toMatchObject({ code: 'EBUSY' });
        await expect(fs.driver.delete(['/session'], { recursive: true })).rejects.toMatchObject({ code: 'EBUSY' });
        await fs.driver.createDirectory({ name: 'outside', parentPath: null });
        await expect(fs.driver.move(['/outside'], '/session/tasks')).rejects.toMatchObject({ code: 'EBUSY' });
        expect((await store.readTask(binding, task.id)).id).toBe(task.id);
    });

    it('persists terminal delivery rejection and exposes it in outbox', async () => {
        const sender = await store.createTask(binding, 's', spec);
        const target = await store.createTask(binding, 's', { ...spec, deferStart: true });
        await store.cancelTask(binding, target.id);
        const message = await store.sendTaskMessage(binding, sender.id, { idempotencyKey: 'once',
            targetSessionId: 's', targetTaskId: target.id, topic: 'done', payload: null });
        expect(message.status).toBe('rejected');
        expect(message.rejection?.code).toBe('target-terminal');
        expect(await store.pendingOutbox(binding)).toEqual([]);
        expect(await store.deliverMessage(binding, message)).toBe(false);
        expect((await store.readTask(binding, target.id)).pendingEvents).toEqual([]);
        expect((await (await kernel.openSession('s')).outbox())[0].status).toBe('rejected');
    });

    it('retains arrivals before waiting and rejects an expired undelivered message', async () => {
        const sender = await store.createTask(binding, 's', { ...spec, deferStart: true });
        const target = await store.createTask(binding, 's', spec);
        await store.sendTaskMessage(binding, sender.id, { idempotencyKey: 'early', targetSessionId: 's', targetTaskId: target.id, topic: 'early', payload: null });
        const claim = (await store.claimReady(binding, 'w', 10_000))!;
        const next = await store.commitTask(binding, claim, { ...claim.task, status: 'waiting', currentAttempt: undefined,
            wait: { type: 'message', topic: 'early' } }, 'task.waiting');
        expect(next.status).toBe('ready');
        const expired = await store.sendTaskMessage(binding, sender.id, { idempotencyKey: 'expired', targetSessionId: 's', targetTaskId: 'not-created', topic: 'late', payload: null, expiresAt: 0 });
        expect(expired.rejection?.code).toBe('expired');
    });

    it('preserves arrivals while the owning reducer commits and renews', async () => {
        const task = await store.createTask(binding, 's', spec);
        const claim = (await store.claimReady(binding, 'w', 10_000))!;
        await store.signalTask(binding, task.id, { type: 'follow-up', payload: 'new' });
        expect(await store.renewLease(binding, claim, 10_000)).toBe(true);
        const next = await store.commitTask(binding, claim, { ...claim.task, state: 1, initialized: true, status: 'waiting', currentAttempt: undefined, wait: { type: 'signal' } }, 'task.waiting');
        expect(next.status).toBe('ready');
        expect(next.pendingEvents).toEqual([expect.objectContaining({ type: 'signal', signal: { type: 'follow-up', payload: 'new' } })]);
    });

    it('propagates terminal dependency failures through the graph and waiters', async () => {
        const a = await store.createTask(binding, 's', spec);
        const b = await store.createTask(binding, 's', { ...spec, dependsOn: [{ task: a.id }] });
        const c = await store.createTask(binding, 's', { ...spec, dependsOn: [{ task: b.id }] });
        await store.cancelTask(binding, a.id);
        expect((await store.readTask(binding, c.id)).status).toBe('failed');
        expect((await store.events(binding)).filter(e => e.type === 'task.failed').map(e => e.taskId)).toEqual([b.id, c.id]);
        await expect(store.createTask(binding, 's', { ...spec, dependsOn: [{ task: 'missing' }] })).rejects.toThrow('Dependency not found');
        await expect(store.createTask(binding, 's', { ...spec, dependsOn: [{ task: a.id }, { task: a.id }] })).rejects.toThrow('Duplicate');
    });

    it('executes internal steps and retries the first failure after many successes', async () => {
        let failed = false;
        const program: DurableTaskProgram<number> = {
            manifest: spec.program,
            init() { return { state: 0, next: { type: 'continue' } }; },
            reduce(state) {
                if (state === 10 && !failed) { failed = true; throw new Error('transient'); }
                return state === 12 ? { state, next: { type: 'complete', output: state } }
                    : { state: state + 1, next: { type: 'continue' } };
            },
        };
        kernel.registerProgram(program);
        const session = await kernel.openSession('s');
        const task = await session.submit({ ...spec, retry: { maxAttempts: 2 } });
        expect((await task.wait({ timeoutMs: 2000 })).output).toBe(12);
        expect((await task.attempts()).filter(a => a.outcome === 'failed')).toHaveLength(1);
    });

    it('fences old decisions and abandonment across a pause/resume', async () => {
        const task = await store.createTask(binding, 's', spec);
        const old = (await store.claimReady(binding, 'old', 10_000))!;
        const pause = await store.controlTask(binding, task.id, 'pause', { requestId: 'pause' });
        expect(pause.acknowledged).toBe(true);
        expect(await store.claimReady(binding, 'new', 10_000)).toBeUndefined();
        await store.signalTask(binding, task.id, { type: 'input' });
        await store.controlTask(binding, task.id, 'run', { requestId: 'resume', expectedEpoch: pause.epoch });
        const current = (await store.claimReady(binding, 'new', 10_000))!;
        await store.abandonClaim(binding, old);
        await expect(store.commitTask(binding, old, { ...old.task, status: 'ready' }, 'task.ready')).rejects.toThrow('Stale');
        expect((await store.readTask(binding, task.id)).currentAttempt?.id).toBe(current.attempt.id);
    });

    it('captures the first shared revision through pause, deletion and recovery', async () => {
        const task = await store.createTask(binding, 's', spec);
        const claim = (await store.claimReady(binding, 'w', 10_000))!;
        await store.commitTask(binding, claim, { ...claim.task, state: null, initialized: true, status: 'waiting', currentAttempt: undefined,
            wait: { type: 'shared-version', key: 'result', afterVersion: 0 } }, 'task.waiting');
        await store.controlTask(binding, task.id, 'pause', { requestId: 'pause' });
        await store.setShared(binding, 'result', 'v1');
        await store.setShared(binding, 'result', 'v2');
        await store.deleteShared(binding, 'result');
        await store.recover(binding);
        const current = await store.readTask(binding, task.id);
        expect(current.pendingEvents).toEqual([{ type: 'shared-changed', revision: expect.objectContaining({ version: 1, value: 'v1' }) }]);
        expect(await store.claimReady(binding, 'w', 10_000)).toBeUndefined();
    });

    it('hydrates timers durably even when polling starts before their deadline', async () => {
        const task = await store.createTask(binding, 's', spec);
        const claim = (await store.claimReady(binding, 'w', 10_000))!;
        await store.commitTask(binding, claim, { ...claim.task, state: null, status: 'waiting', currentAttempt: undefined,
            wait: { type: 'timer', id: 'alarm', at: Date.now() + 10 } }, 'task.waiting');
        await new Promise(resolve => setTimeout(resolve, 20));
        await store.sweep(binding);
        expect((await store.readTask(binding, task.id)).status).toBe('ready');
    });

    it('preserves successful effects and refuses unsafe replay', async () => {
        const task = await store.createTask(binding, 's', spec);
        const request = { id: 'effect', kind: 'write', version: '1', idempotencyKey: 'key', request: null, timeoutMs: 100 };
        const original = addEffect(task, request); original.effects.effect.status = 'succeeded';
        expect(addEffect(original, request).effects.effect.status).toBe('succeeded');
        expect(() => addEffect(original, { ...request, request: 'different' })).toThrow('conflict');
        let executions = 0;
        const completion = await executeEffectAdapter({ kind: 'write', version: '1', async execute() { executions++; return null; } }, request,
            { taskId: task.id, effectId: 'effect', effect: { ...original.effects.effect, attempts: [{ outcome: 'lost' } as any] } },
            { sessionId: 's', taskId: task.id, effectId: 'effect', grants: [], abortSignal: new AbortController().signal });
        expect(executions).toBe(0); expect(completion.indeterminate).toBe(true);
    });

    it('selects authorized cache sources and preserves receipts after invalidation', async () => {
        const task = await store.createTask(binding, 's', spec);
        const other = await store.createTask(binding, 's', spec);
        const { namespace, handle } = await store.createCache(binding, task.id, { name: 'parsed' });
        await store.publishCache(binding, task.id, { operationId: 'publish', handleId: handle.id, key: 'file', fingerprint: 'hash-v1', value: { ast: 1 }, expectedGeneration: 1 });
        const request = { operationId: 'read', sources: [{ handleId: handle.id, key: 'file', fingerprint: 'hash-v1' }] };
        expect((await store.readCache(binding, task.id, request)).value).toEqual({ ast: 1 });
        await expect(store.readCache(binding, other.id, request)).rejects.toThrow('holder mismatch');
        await store.invalidateCache(binding, task.id, handle.id, namespace.generation);
        expect((await store.readCache(binding, task.id, request)).value).toEqual({ ast: 1 });
        expect((await store.readCache(binding, task.id, { ...request, operationId: 'new-read' })).status).toBe('miss');
        await expect(store.publishCache(binding, task.id, { operationId: 'stale', handleId: handle.id, key: 'file', fingerprint: 'hash-v1', value: 2, expectedGeneration: 1 })).rejects.toThrow('generation conflict');
    });

    it('takes single-use cache atomically and replays only the winning receipt', async () => {
        const a = await store.createTask(binding, 's', spec), b = await store.createTask(binding, 's', spec);
        const { handle } = await store.createCache(binding, a.id, { name: 'once', usage: 'single-use', scope: 'session' });
        const shared = await store.grantResource(binding, 'shared-handle', handle.id, b.id, ['read']);
        await store.publishCache(binding, a.id, { operationId: 'put', handleId: handle.id, key: 'key', fingerprint: 'v1', value: 'result', expectedGeneration: 1 });
        const request = (handleId: string) => ({ operationId: 'take', sources: [{ handleId, key: 'key', fingerprint: 'v1' }] });
        const results = await Promise.all([store.readCache(binding, a.id, request(handle.id)), store.readCache(binding, b.id, request(shared.id))]);
        expect(results.map(r => r.status).sort()).toEqual(['hit', 'miss']);
        expect(await store.readCache(binding, a.id, request(handle.id))).toEqual(results[0]);
        expect(await store.readCache(binding, b.id, request(shared.id))).toEqual(results[1]);
    });

    it('commits cache selection and its wake input with the decision', async () => {
        const t = await store.createTask(binding, 's', spec);
        const { handle } = await store.createCache(binding, t.id, { name: 'own' });
        const claim = (await store.claimReady(binding, 'w', 10000))!;
        const request = { operationId: 'selection', sources: [{ handleId: handle.id, key: 'key', fingerprint: 'v1' }] };
        const next: TaskRecord = { ...claim.task, state: null, status: 'waiting', currentAttempt: undefined, wait: { type: 'cache', operationId: 'selection' } };
        const committed = await store.commitTask(binding, claim, next, 'task.waiting', undefined, { cache: [
            { type: 'cache-publish', request: { operationId: 'put', handleId: handle.id, key: 'key', fingerprint: 'v1', value: 'cached', expectedGeneration: 1 } },
            { type: 'cache-read', request },
        ] });
        expect(committed.status).toBe('ready');
        expect(committed.pendingEvents).toEqual([{ type: 'cache-result', receipt: expect.objectContaining({ value: 'cached' }) }]);
    });

    it('deduplicates mailbox deliveries and commits consumption with a reply', async () => {
        const sender = await store.createTask(binding, 's', { ...spec, deferStart: true });
        const receiver = await store.createTask(binding, 's', spec);
        const init = (await store.claimReady(binding, 'w', 10000))!;
        await store.commitTask(binding, init, { ...init.task, initialized: true, state: null, status: 'waiting', currentAttempt: undefined, wait: { type: 'message', topic: 'request' } }, 'task.waiting');
        const request = { idempotencyKey: 'one', targetSessionId: 's', targetTaskId: receiver.id, topic: 'request', payload: 'work' };
        const message = await store.sendTaskMessage(binding, sender.id, request);
        await store.sendTaskMessage(binding, sender.id, request);
        expect((await store.readTask(binding, receiver.id)).pendingEvents).toHaveLength(1);
        const claim = (await store.claimReady(binding, 'w', 10000))!;
        const next: TaskRecord = { ...claim.task, pendingEvents: [], status: 'waiting', currentAttempt: undefined, wait: { type: 'signal' } };
        const reply = { idempotencyKey: 'reply', targetSessionId: 's', targetTaskId: sender.id, topic: 'reply', correlationId: message.id, payload: 'done' };
        await store.commitTask(binding, claim, next, 'task.waiting', undefined, { messages: [reply] });
        expect((await store.inbox(binding)).find(m => m.id === message.id)?.consumedAt).toBeTypeOf('number');
        expect((await store.readTask(binding, sender.id)).pendingEvents).toEqual([expect.objectContaining({ type: 'message', message: expect.objectContaining({ payload: 'done', correlationId: message.id }) })]);
        await expect(store.sendTaskMessage(binding, sender.id, { ...request, payload: 'changed' })).rejects.toThrow('identity conflict');
    });

    it('delivers cross-session Task messages idempotently after acknowledgement loss', async () => {
        const targetBinding = { fs, rootPath: '/target' };
        const targetStore = new SeqFileKernelStore({ fs, rootPath: '/catalog' }, async () => targetBinding);
        await targetStore.createSession('target', { kind: 'test', locator: { rootPath: '/target' } });
        const sender = await store.createTask(binding, 's', { ...spec, deferStart: true });
        const receiver = await targetStore.createTask(targetBinding, 'target', { ...spec, deferStart: true });
        const request = { idempotencyKey: 'one', targetSessionId: 'target', targetTaskId: receiver.id, topic: 'work', payload: null };
        const message = await store.sendTaskMessage(binding, sender.id, request);
        expect(message.status).toBe('pending');
        expect(await targetStore.deliverMessage(targetBinding, message)).toBe(true);
        await targetStore.cancelTask(targetBinding, receiver.id);
        expect(await targetStore.deliverMessage(targetBinding, message)).toBe(false);
        expect((await targetStore.messageReceipt(targetBinding, message.id)).status).toBe('delivered');
        await store.markMessageDelivered(binding, message.id);
        expect((await targetStore.readTask(targetBinding, receiver.id)).pendingEvents).toHaveLength(1);
        expect(await store.pendingOutbox(binding)).toHaveLength(0);
    });

    it('recovers a lease at its deadline when it was valid as the new worker opened', async () => {
        const t = await store.createTask(binding, 's', { ...spec, retry: { maxAttempts: 2 } });
        await store.claimReady(binding, 'lost-worker', 30);
        kernel.registerProgram({ manifest: spec.program, init: () => ({ state: null, next: { type: 'complete', output: 'recovered' } }), reduce: () => { throw new Error('unexpected'); } });
        const session = await kernel.openSession('s');
        const handle = await session.attachTask(t.id);
        expect((await handle.wait({ timeoutMs: 2000 })).output).toBe('recovered');
        expect((await handle.attempts()).map(a => a.outcome)).toEqual(['lost', 'completed']);
    });

    it('does not resume an independently paused child when its parent resumes', async () => {
        const parent = await store.createTask(binding, 's', { ...spec, deferStart: true });
        const child = await store.createTask(binding, 's', { ...spec, parent: parent.id });
        await store.controlTask(binding, child.id, 'pause', { requestId: 'child-pause' });
        await store.controlTask(binding, parent.id, 'pause', { requestId: 'parent-pause' });
        await store.controlTask(binding, parent.id, 'run', { requestId: 'parent-resume' });
        expect((await store.readTask(binding, child.id)).control?.mode).toBe('pause');
        expect(await store.claimReady(binding, 'w', 10000)).toBeUndefined();
    });

    it('fences cancelled effect event and shared-state writes', async () => {
        const t = await store.createTask(binding, 's', spec);
        const claim = (await store.claimReady(binding, 'w', 10000))!;
        const next = addEffect({ ...claim.task, state: null, status: 'waiting' as const, currentAttempt: undefined, wait: { type: 'effect' as const } }, { id: 'e', kind: 'x', version: '1', idempotencyKey: 'e', request: null, timeoutMs: 1000 });
        await store.commitTask(binding, claim, next, 'task.waiting');
        const effect = (await store.claimEffect(binding, t.id, 'e', 'w', 10000))!;
        await store.cancelTask(binding, t.id);
        await expect(store.appendEvent(binding, 's', t.id, 'late-chunk', 'data', effect)).rejects.toThrow('Stale effect');
        await expect(store.setShared(binding, 'late', 'data', { taskId: t.id }, effect)).rejects.toThrow('Stale effect');
        expect(await store.getShared(binding, 'late')).toBeUndefined();
    });

    it('rejects a stale task-board claimant after reassignment', async () => {
        const session = await kernel.openSession('s');
        await session.createTaskBoardItem({ id: 'job', title: 'Job' });
        const taskA = await store.createTask(binding, 's', { ...spec, deferStart: true });
        const taskB = await store.createTask(binding, 's', { ...spec, deferStart: true });
        const a = await session.claimTaskBoardItem('job', taskA.id, { leaseMs: 1 });
        await new Promise(resolve => setTimeout(resolve, 5));
        const b = await session.claimTaskBoardItem('job', taskB.id);
        await expect(session.completeTaskBoardItem('job', a.leaseToken!, 'old')).rejects.toThrow();
        expect((await session.completeTaskBoardItem('job', b.leaseToken!, 'new')).result).toBe('new');
    });

    it('drains existing tasks before closing and forbids resurrection', async () => {
        const t = await store.createTask(binding, 's', spec);
        kernel.registerProgram({ manifest: spec.program, init: () => ({ state: null, next: { type: 'complete', output: null } }), reduce: () => { throw new Error('unexpected'); } });
        await kernel.closeSession('s', false);
        const handle = await kernel.openTask(t.id);
        expect((await handle.wait({ timeoutMs: 2000 })).status).toBe('succeeded');
        await expect.poll(async () => (await store.sessionRecord(binding)).status).toBe('closed');
        await expect(store.setSessionStatus(binding, 'open')).rejects.toThrow('Invalid session transition');
    });

    it('holds unknown effects for an idempotent manual resolution', async () => {
        const t = await store.createTask(binding, 's', spec);
        const claim = (await store.claimReady(binding, 'w', 10000))!;
        const next = addEffect({ ...claim.task, state: null, initialized: true, status: 'waiting' as const, currentAttempt: undefined, wait: { type: 'effect' as const, id: 'unknown' } },
            { id: 'unknown', kind: 'write', version: '1', request: null, idempotencyKey: 'unknown', timeoutMs: 1000 });
        await store.commitTask(binding, claim, next, 'task.waiting');
        const effect = (await store.claimEffect(binding, t.id, 'unknown', 'w', 10000))!;
        await store.completeEffect(binding, t.id, 'unknown', effect.effect.currentAttempt!.leaseToken, { error: { message: 'unknown' }, indeterminate: true });
        expect((await store.readTask(binding, t.id)).status).toBe('waiting');
        const resolution = { requestId: 'verified', effectId: 'unknown', outcome: { type: 'completed' as const, result: 'external-result' } };
        await store.resolveEffect(binding, t.id, resolution);
        await store.resolveEffect(binding, t.id, resolution);
        const current = await store.readTask(binding, t.id);
        expect(current.status).toBe('ready');
        expect(current.pendingEvents).toEqual([{ type: 'effect-completed', effectId: 'unknown', result: 'external-result' }]);
        await expect(store.resolveEffect(binding, t.id, { ...resolution, outcome: { type: 'completed', result: 'different' } })).rejects.toThrow('conflict');
    });

    it('retries only explicitly replay-safe effects with persistent backoff', async () => {
        let calls = 0;
        kernel.registerEffect({ kind: 'safe', version: '1', recoveryPolicy: 'idempotent-retry', async execute() { if (++calls === 1) throw new Error('temporary'); return 'done'; } });
        kernel.registerProgram({ manifest: spec.program,
            init() { return { state: null, actions: [{ type: 'effect', effect: { id: 'e', kind: 'safe', version: '1', request: null, idempotencyKey: 'e', retry: { maxAttempts: 2, backoffMs: 5 } } }], next: { type: 'wait', on: { type: 'effect', id: 'e' } } }; },
            reduce(state, event) { return { state, next: { type: 'complete', output: event.type === 'effect-completed' ? event.result : 'wrong' } }; },
        });
        const session = await kernel.openSession('s'), task = await session.submit(spec);
        expect((await task.wait({ timeoutMs: 2000 })).output).toBe('done');
        expect(calls).toBe(2);
        expect((await task.status()).task.effects.e.attempts.map(a => a.outcome)).toEqual(['failed', 'completed']);
    });

    it('keeps suspend pending until its external effect has settled', async () => {
        const t = await store.createTask(binding, 's', spec);
        const claim = (await store.claimReady(binding, 'w', 10000))!;
        await store.commitTask(binding, claim, addEffect({ ...claim.task, status: 'waiting' as const, currentAttempt: undefined, wait: { type: 'effect' as const } },
            { id: 'e', kind: 'x', version: '1', request: null, idempotencyKey: 'e', timeoutMs: 1000 }), 'task.waiting');
        const effect = (await store.claimEffect(binding, t.id, 'e', 'w', 10000))!;
        expect((await store.setSessionStatus(binding, 'suspended')).status).toBe('suspending');
        await store.completeEffect(binding, t.id, 'e', effect.effect.currentAttempt!.leaseToken, { result: 'settled' });
        expect((await store.setSessionStatus(binding, 'suspended')).status).toBe('suspended');
        expect(await store.claimReady(binding, 'w', 10000)).toBeUndefined();
        await store.setSessionStatus(binding, 'open');
        expect((await store.claimReady(binding, 'w', 10000))?.task.id).toBe(t.id);
    });

    it('reuses durable submission identities and rejects changed requests', async () => {
        const request = { ...spec, requestId: 'submit-once' };
        const [a, b] = await Promise.all([store.createTask(binding, 's', request), store.createTask(binding, 's', request)]);
        expect(a.id).toBe(b.id);
        expect(await store.listTasks(binding)).toHaveLength(1);
        await expect(store.createTask(binding, 's', { ...request, input: 'changed' })).rejects.toThrow('submission conflict');
        await expect(store.createSession('different-session', { kind: 'test', locator: null })).rejects.toThrow('already belongs');
        expect((await store.sessionRecord(binding)).id).toBe('s');
    });

    it('blocks missing program versions without destroying recoverable work', async () => {
        const session = await kernel.openSession('s'), task = await session.submit(spec);
        await expect.poll(async () => (await task.status()).task.blockedReason).toBe('program-unavailable');
        expect(await task.poll()).toBeUndefined();
        kernel.registerProgram({ manifest: spec.program, init: () => ({ state: null, next: { type: 'complete', output: 'restored' } }), reduce: () => { throw new Error('unexpected'); } });
        expect((await task.wait({ timeoutMs: 2000 })).output).toBe('restored');
    });

    it('does not persist reducer mutations from a failed attempt', async () => {
        let failures = 0;
        const program: DurableTaskProgram<{ count: number }> = {
            manifest: spec.program, init: () => ({ state: { count: 0 }, next: { type: 'continue' } }),
            reduce(state) {
                if (failures++ === 0) { (state as { count: number }).count = 999; throw new Error('retry'); }
                return { state, next: { type: 'complete', output: state.count } };
            },
        };
        kernel.registerProgram(program);
        const session = await kernel.openSession('s'), task = await session.submit({ ...spec, retry: { maxAttempts: 2 } });
        expect((await task.wait({ timeoutMs: 2000 })).output).toBe(0);
    });

    it('renews live cache entries without reviving expired entries or old fills', async () => {
        const task = await store.createTask(binding, 's', spec);
        const { handle } = await store.createCache(binding, task.id, { name: 'ttl', ttlMs: 1000 });
        const write = { operationId: 'put', handleId: handle.id, key: 'value', fingerprint: 'v1', value: 'value', expectedGeneration: 1 };
        await store.publishCache(binding, task.id, write);
        const renewed = await store.renewCache(binding, task.id, handle.id, 1, 2000);
        expect(renewed.generation).toBe(2);
        const request = { operationId: 'read', sources: [{ handleId: handle.id, key: 'value', fingerprint: 'v1' }] };
        expect((await store.readCache(binding, task.id, request)).status).toBe('hit');
        await expect(store.publishCache(binding, task.id, { ...write, operationId: 'stale-fill' })).rejects.toThrow('generation conflict');
        const expiring = await store.createCache(binding, task.id, { name: 'short', ttlMs: 1 });
        await store.publishCache(binding, task.id, { ...write, handleId: expiring.handle.id, operationId: 'short-put' });
        await new Promise(resolve => setTimeout(resolve, 5));
        await store.renewCache(binding, task.id, expiring.handle.id, 1, 1000);
        expect((await store.readCache(binding, task.id, { operationId: 'expired-read', sources: [{ handleId: expiring.handle.id, key: 'value', fingerprint: 'v1' }] })).status).toBe('miss');
    });

    it('bounds external effect concurrency independently of reducer claims', async () => {
        let active = 0, maximum = 0;
        kernel.registerEffect({ kind: 'bounded', version: '1', async execute() {
            active++; maximum = Math.max(maximum, active);
            await new Promise(resolve => setTimeout(resolve, 10));
            active--; return null;
        } });
        const ids = ['one', 'two', 'three', 'four'];
        const program: DurableTaskProgram<number> = {
            manifest: spec.program,
            init() { return { state: 0, actions: ids.map(id => ({ type: 'effect', effect: {
                id, kind: 'bounded', version: '1', idempotencyKey: id, request: null,
            } })), next: { type: 'wait', on: { type: 'all', waits: ids.map(id => ({ type: 'effect', id })) } } }; },
            reduce(state) { return { state: state + 1, next: state === 3 ? { type: 'complete', output: 'done' } : { type: 'continue' } }; },
        };
        kernel.registerProgram(program);
        const task = await (await kernel.openSession('s')).submit(spec);
        expect((await task.wait({ timeoutMs: 2000 })).output).toBe('done');
        expect(maximum).toBe(2);
    });

    it('releases a hung reducer slot when pause invalidates its claim', async () => {
        kernel.dispose(); await kernel.waitIdle();
        kernel = new Kernel({ catalog: { fs, rootPath: '/catalog' }, pollMs: 0, maxConcurrent: 1 });
        kernel.registerStorageResolver({ kind: 'test', async resolve() { return binding; } });
        let calls = 0;
        kernel.registerProgram({ manifest: spec.program,
            async init() { if (++calls === 1) return new Promise(() => {}); return { state: null, next: { type: 'complete', output: 'resumed' } }; },
            reduce() { throw new Error('unexpected'); },
        });
        const task = await (await kernel.openSession('s')).submit(spec);
        await expect.poll(async () => (await task.status()).task.status).toBe('running');
        const pause = await task.pause({ requestId: 'pause' });
        await task.resume({ requestId: 'resume', expectedEpoch: pause.epoch });
        expect((await task.wait({ timeoutMs: 2000 })).output).toBe('resumed');
        expect(calls).toBe(2);
    });

    it('fences descendant decisions immediately after ancestor cancellation', async () => {
        const root = await store.createTask(binding, 's', { ...spec, deferStart: true });
        const child = await store.createTask(binding, 's', { ...spec, parent: root.id });
        const claim = (await store.claimReady(binding, 'worker', 10000))!;
        await store.cancelTask(binding, root.id);
        expect(await store.renewLease(binding, claim, 10000)).toBe(false);
        await expect(store.commitTask(binding, claim, { ...claim.task, status: 'ready' }, 'task.ready')).rejects.toThrow('ancestor cancelled');
        await store.sweep(binding);
        expect((await store.readTask(binding, child.id)).status).toBe('cancelled');
    });

    it('lets a program create and use its own cache entirely through decisions', async () => {
        kernel.registerProgram({ manifest: spec.program,
            init() { return { state: null, actions: [{ type: 'cache-create', operationId: 'create', spec: { name: 'private' } }],
                next: { type: 'wait', on: { type: 'cache-management', operationId: 'create' } } }; },
            reduce(state, event) {
                if (event.type === 'cache-managed' && event.receipt.type === 'created') {
                    const handleId = event.receipt.handle.id;
                    return { state, actions: [
                        { type: 'cache-publish', request: { operationId: 'fill', handleId, key: 'key', fingerprint: 'v1', value: 'derived', expectedGeneration: 1 } },
                        { type: 'cache-read', request: { operationId: 'read', sources: [{ handleId, key: 'key', fingerprint: 'v1' }] } },
                    ], next: { type: 'wait', on: { type: 'cache', operationId: 'read' } } };
                }
                if (event.type === 'cache-result') return { state, next: { type: 'complete', output: event.receipt.value } };
                throw new Error('Unexpected input');
            },
        });
        const task = await (await kernel.openSession('s')).submit(spec);
        expect((await task.wait({ timeoutMs: 2000 })).output).toBe('derived');
    });
});
