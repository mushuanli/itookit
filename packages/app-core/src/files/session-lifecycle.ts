import { FSError } from '@itookit/vfs-core';
import { KernelError, KernelErrorCode, type Kernel } from '@itookit/durable-kernel';
import type { ISessionRepository } from '@itookit/llm-session';

export interface SessionLifecycleDependencies { repository: ISessionRepository; kernel: Kernel }
export interface SessionLifecycleOptions {
    /** Bounded wait for the Kernel to reach `closed` after closeSession; default 30s. */
    closeTimeoutMs?: number;
    closePollMs?: number;
}

/**
 * Single entry point for Session deletion: close the Kernel Session, wait until it
 * is really closed, remove Kernel storage and catalog, and only then delete the
 * repository records. Every step keeps the Session intact when it fails.
 */
export class SessionLifecycleService {
    constructor(
        private readonly deps: SessionLifecycleDependencies,
        private readonly options: SessionLifecycleOptions = {},
    ) {}

    async deleteSession(sessionId: string): Promise<void> {
        await this.deps.repository.getManifest(sessionId);
        await this.closeAndWait(sessionId);
        await this.deps.kernel.removeSession(sessionId);
        await this.deps.repository.deleteSession(sessionId);
    }

    async deleteFolder(path: string, recursive = false): Promise<void> {
        if (!recursive) {
            await this.deps.repository.deleteFolder(path, false);
            return;
        }
        const sessions = (await this.deps.repository.list())
            .filter(session => session.folder === path || session.folder?.startsWith(`${path}/`));
        for (const session of sessions) await this.deleteSession(session.id);
        await this.deps.repository.deleteFolder(path, true);
    }

    /** Close cancels running Tasks; deleting before it settles would race live state. */
    private async closeAndWait(sessionId: string): Promise<void> {
        try {
            await this.deps.kernel.closeSession(sessionId, true);
        } catch (error) {
            if (!isMissingSession(error)) {
                const reason = error instanceof Error ? error.message : String(error);
                throw new FSError('EBUSY', `Session ${sessionId} could not be closed: ${reason}; nothing was deleted`);
            }
        }
        const deadline = Date.now() + (this.options.closeTimeoutMs ?? 30_000);
        for (;;) {
            const stat = await this.stat(sessionId);
            if (!stat || stat.phase === 'closed') return;
            if (Date.now() >= deadline) {
                throw new FSError('EBUSY', `Session ${sessionId} is still ${stat.blockedBy ?? stat.phase}; nothing was deleted`);
            }
            await new Promise(resolve => setTimeout(resolve, this.options.closePollMs ?? 50));
        }
    }

    private async stat(sessionId: string) {
        try {
            return await this.deps.kernel.sessionStat(sessionId);
        } catch (error) {
            if (isMissingSession(error)) return null;
            throw error;
        }
    }
}

/** A Session without Kernel records has nothing to close; the repository still owns it. */
function isMissingSession(error: unknown): boolean {
    return error instanceof KernelError && error.code === KernelErrorCode.SESSION_NOT_FOUND;
}
