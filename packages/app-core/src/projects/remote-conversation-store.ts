import { FSError, type IFileSystem } from '@itookit/vfs-core';
import type { HarnessRecovery } from '@itookit/piagent-driver';
/** Persist native references and pending receipts; never native conversation histories. */
export class RemoteConversationStore {
    private raw: string | null = null;
    constructor(private readonly fs: IFileSystem, private readonly key: string) {}
    private readonly path = '/etc/fs/harness-conversations.seq';
    async load(): Promise<HarnessRecovery | undefined> {
        if (!await this.fs.driver.exists(this.path)) return;
        this.raw = await this.fs.meta.seq!.getEntry(this.path, this.key);
        if (!this.raw) return;
        const record = JSON.parse(this.raw) as HarnessRecovery;
        if (record.draft !== undefined && (typeof record.draft !== 'string' || record.draft.length > 1024 * 1024)) throw new FSError('EINVAL', 'Invalid remote input draft');
        if (record.sessionId !== undefined && typeof record.sessionId !== 'string' || record.pending &&
            (!record.pending.requestId || typeof record.pending.epoch !== 'string' || typeof record.pending.operation !== 'string')) throw new FSError('EINVAL', 'Invalid remote conversation recovery');
        return record;
    }
    async save(record: HarnessRecovery): Promise<void> {
        if (!await this.fs.driver.exists(this.path)) {
            try { await this.fs.driver.createFile({parentPath: '/etc/fs', name: 'harness-conversations.seq', type: 'seqfile', recursive: true}); }
            catch (error) { if ((error as {code?: string}).code !== 'EEXIST') throw error; }
        }
        const value = JSON.stringify(record);
        await this.fs.meta.seq!.transaction!(async tx => {
            if (!await tx.compareAndSet(this.path, this.key, {expected: this.raw, value})) throw new FSError('ECONFLICT', 'Remote conversation is controlled by another view');
        });
        this.raw = value;
    }
}
