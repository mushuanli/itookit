import { FSError, type IFileSystem } from '@itookit/vfs-core';
import { decodeExecutionBinding } from './policy';
import type { ExecutionBindingStore, ProjectExecutionBinding } from './contracts';

export class ProjectExecutionStore implements ExecutionBindingStore {
    constructor(private readonly fs: IFileSystem) {}
    private path(projectId: string): string {
        if (typeof projectId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(projectId)) throw new FSError('EINVAL', 'Invalid project identity');
        return `/etc/fs/projects/${projectId}.seq`;
    }
    async read(projectId: string): Promise<{ raw: string | null; binding: ProjectExecutionBinding | null }> {
        const path = this.path(projectId);
        const raw = await this.fs.driver.exists(path) ? await this.fs.meta.seq!.getEntry(path, 'execution') : null;
        if (raw === null) return { raw, binding: null };
        return { raw, binding: decodeExecutionBinding(raw) };
    }
    async write(projectId: string, expected: string | null, binding: ProjectExecutionBinding | null): Promise<void> {
        if (binding) decodeExecutionBinding(JSON.stringify(binding));
        const path = this.path(projectId);
        if (!await this.fs.driver.exists(path)) {
            try { await this.fs.driver.createFile({ parentPath: '/etc/fs/projects', name: `${projectId}.seq`, type: 'seqfile', recursive: true }); }
            catch (error) { if (!(error instanceof FSError) || error.code !== 'EEXIST') throw error; }
        }
        await this.fs.meta.seq!.transaction!(async tx => {
            if (!await tx.compareAndSet(path, 'execution', { expected, value: binding ? JSON.stringify(binding) : null }))
                throw new FSError('ECONFLICT', 'Project execution binding changed');
        });
    }
}
