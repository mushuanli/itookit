import type { ISeqFileTransaction } from '@itookit/vfs-core';
import type { CrossSessionMessage, TaskMessageRequest, TaskRecord } from '../../domain/types';
import { assertDurableValue } from '../../application/durability';
import { appendEventTx, decode, encode, inboxKey, messagesPath, outboxKey } from './seqfile-core';
import { indexTask, isTerminal, requireSessionTx, requireTaskTx, unregisterTaskWaitTx, wakeFromPendingEvents, writeTaskTx } from './store-helpers';

export async function enqueueMessageTx(tx: ISeqFileTransaction, root: string, sender: TaskRecord, request: TaskMessageRequest): Promise<CrossSessionMessage> {
    if (!request.idempotencyKey || !request.topic || !request.targetTaskId || !request.targetSessionId) throw new Error('Message identity, topic and target are required');
    assertDurableValue(request.payload, 'Message payload');
    if (request.expiresAt !== undefined && !Number.isFinite(request.expiresAt)) throw new Error('Invalid message deadline');
    const id = `${sender.id}:${encodeURIComponent(request.idempotencyKey)}`;
    const raw = await tx.getEntry(messagesPath(root), outboxKey(id));
    const fingerprint = encode(request);
    if (raw) {
        const old = decode<CrossSessionMessage>(raw);
        if (old.requestFingerprint !== fingerprint) throw new Error('Message identity conflict');
        return old;
    }
    const message: CrossSessionMessage = {
        id, sourceSessionId: sender.sessionId, sourceTaskId: sender.id,
        targetSessionId: request.targetSessionId, targetTaskId: request.targetTaskId,
        topic: request.topic, payload: request.payload, correlationId: request.correlationId,
        status: 'pending', createdAt: Date.now(), requestFingerprint: fingerprint, expiresAt: request.expiresAt,
    };
    await tx.setEntry(messagesPath(root), outboxKey(id), encode(message));
    await appendEventTx(tx, root, sender.sessionId, sender.id, 'session.message.queued', message);
    if (message.targetSessionId === sender.sessionId) {
        await deliverMessageTx(tx, root, message);
        Object.assign(message, decode<CrossSessionMessage>((await tx.getEntry(messagesPath(root), inboxKey(message.id)))!));
        await tx.setEntry(messagesPath(root), outboxKey(id), encode(message));
    }
    return message;
}

export async function deliverMessageTx(tx: ISeqFileTransaction, root: string, message: CrossSessionMessage): Promise<boolean> {
    const existing = await tx.getEntry(messagesPath(root), inboxKey(message.id));
    if (existing) {
        const old = decode<CrossSessionMessage>(existing);
        if (messageIdentity(old) !== messageIdentity(message)) throw new Error('Message identity conflict');
        return false;
    }
    const session = await requireSessionTx(tx, root);
    if (session.id !== message.targetSessionId) throw new Error('Message target session identity mismatch');
    if (message.expiresAt !== undefined && message.expiresAt <= Date.now()) return rejectMessageTx(tx, root, message, 'expired', 'Message delivery deadline expired');
    if (session.status !== 'open' && session.status !== 'suspended' && session.status !== 'suspending') {
        return rejectMessageTx(tx, root, message, 'target-closed', 'Message target session is unavailable');
    }
    const sequence = await tx.increment(messagesPath(root), 'delivery-sequence');
    const delivered: CrossSessionMessage = { ...message, deliverySequence: sequence, status: 'delivered', deliveredAt: Date.now() };
    if (message.targetTaskId) {
        const task = await requireTaskTx(tx, root, message.targetTaskId);
        if (isTerminal(task.status)) return rejectMessageTx(tx, root, message, 'target-terminal', 'Message target task is terminal');
        let next: TaskRecord = { ...task, pendingEvents: [...task.pendingEvents, { type: 'message', message: delivered }],
            version: task.version + 1, updatedAt: Date.now() };
        next = wakeFromPendingEvents(next);
        if (next.status === 'ready') await unregisterTaskWaitTx(tx, root, task);
        await writeTaskTx(tx, root, next); await indexTask(tx, root, next);
    }
    await tx.setEntry(messagesPath(root), inboxKey(message.id), encode(delivered));
    await appendEventTx(tx, root, message.targetSessionId, message.targetTaskId, 'session.message.received', delivered);
    return true;
}

export async function consumeMessageTx(tx: ISeqFileTransaction, root: string, task: TaskRecord, id: string): Promise<void> {
    const key = inboxKey(id), raw = await tx.getEntry(messagesPath(root), key);
    if (!raw) throw new Error('Message receipt is missing');
    const message = decode<CrossSessionMessage>(raw);
    if (message.targetTaskId !== task.id) throw new Error('Message consumer mismatch');
    if (message.consumedAt !== undefined) return;
    await tx.setEntry(messagesPath(root), key, encode({ ...message, consumedAt: Date.now() }));
    await appendEventTx(tx, root, task.sessionId, task.id, 'message.consumed', { messageId: id });
}

function messageIdentity(message: CrossSessionMessage): string {
    return encode([message.id, message.sourceSessionId, message.sourceTaskId, message.targetSessionId,
        message.targetTaskId, message.topic, message.correlationId, message.payload, message.requestFingerprint, message.expiresAt]);
}

async function rejectMessageTx(tx: ISeqFileTransaction, root: string, message: CrossSessionMessage,
    code: NonNullable<CrossSessionMessage['rejection']>['code'], reason: string): Promise<boolean> {
    const rejected: CrossSessionMessage = { ...message, status: 'rejected', rejectedAt: Date.now(), rejection: { code, message: reason } };
    await tx.setEntry(messagesPath(root), inboxKey(message.id), encode(rejected));
    await appendEventTx(tx, root, message.targetSessionId, message.targetTaskId, 'session.message.rejected', rejected);
    return false;
}
