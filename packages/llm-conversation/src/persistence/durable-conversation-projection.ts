import type { JsonValue, SessionHandle } from '@itookit/harness';
import type { SessionRuntime } from '../core/types';
import type { IChatEngine } from './types';

const MANIFEST_KEY = 'conversation/manifest';
export const RUNTIME_KEY = 'conversation/runtime';

export class DurableConversationProjection {
    private readonly tails = new Map<string, Promise<void>>();

    constructor(private readonly engine: IChatEngine) {}

    sync(handle: SessionHandle, nodeId: string, runtime?: SessionRuntime): Promise<void> {
        const previous = this.tails.get(handle.id) ?? Promise.resolve();
        const current = previous.catch(() => {}).then(() => this.syncNow(handle, nodeId, runtime));
        this.tails.set(handle.id, current);
        return current.finally(() => {
            if (this.tails.get(handle.id) === current) this.tails.delete(handle.id);
        });
    }

    private async syncNow(handle: SessionHandle, nodeId: string, runtime?: SessionRuntime): Promise<void> {
        const manifest = await this.engine.getManifest(nodeId);
        await syncValue(handle, MANIFEST_KEY, manifest as unknown as JsonValue);
        if (runtime) await syncValue(handle, RUNTIME_KEY, runtimeValue(runtime));
    }
}

async function syncValue(handle: SessionHandle, key: string, input: JsonValue): Promise<void> {
        const value = JSON.parse(JSON.stringify(input)) as JsonValue;
        const current = await handle.getShared(key);
        if (JSON.stringify(current?.value) === JSON.stringify(value)) return;
        await handle.setShared(key, value, { expectedVersion: current?.version ?? null });
}

function runtimeValue(runtime: SessionRuntime): JsonValue {
    return {
        sessionId: runtime.sessionId,
        nodeId: runtime.nodeId,
        status: runtime.status,
        unreadCount: runtime.unreadCount,
        lastActiveTime: runtime.lastActiveTime,
    };
}
