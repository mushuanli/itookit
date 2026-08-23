import type {
    ResolvedStorageBinding,
    SessionStorageResolver,
    StorageBindingRef,
} from '@itookit/kernel';
import { FS_MODULE_CHAT } from '@itookit/vfs-core';
import type { IChatEngine } from './types';

export const CHAT_HARNESS_STORAGE_KIND = 'chat-asset';

export class ChatKernelStorageResolver implements SessionStorageResolver {
    readonly kind = CHAT_HARNESS_STORAGE_KIND;

    constructor(private readonly chat: IChatEngine) {}

    async resolve(reference: StorageBindingRef): Promise<ResolvedStorageBinding> {
        const sessionId = readSessionId(reference);
        const nodeId = await this.chat.getSessionNodeId(sessionId);
        if (!nodeId) throw new Error(`Chat session not found: ${sessionId}`);
        const root = await this.chat.getAssetDirectoryId(nodeId);
        if (!root) throw new Error(`Chat asset directory not found: ${sessionId}`);
        return {
            fs: this.chat.vfs.getEngine(FS_MODULE_CHAT),
            rootPath: `${root}/.kernel`,
        };
    }
}

export function chatKernelStorage(sessionId: string): StorageBindingRef {
    return { kind: CHAT_HARNESS_STORAGE_KIND, locator: { sessionId } };
}

function readSessionId(reference: StorageBindingRef): string {
    const locator = reference.locator;
    if (!locator || Array.isArray(locator) || typeof locator !== 'object') {
        throw new Error('Invalid chat storage locator');
    }
    const sessionId = locator.sessionId;
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('Chat storage locator requires sessionId');
    return sessionId;
}
