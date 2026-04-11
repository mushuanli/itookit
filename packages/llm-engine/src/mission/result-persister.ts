// @file: llm-engine/src/mission/result-persister.ts
// VFS-backed implementation of IResultPersistenceService.

import type { IVFSManager } from '@itookit/common';
import type { IResultPersistenceService } from '@itookit/common';
import { MISSION_MODULE } from '@itookit/common';
import { BaseModuleService } from '@itookit/vfslib';

export class ResultPersistenceService extends BaseModuleService implements IResultPersistenceService {
    constructor(vfs: IVFSManager) {
        super(MISSION_MODULE, { description: 'Mission result persistence' }, vfs);
    }

    protected async onLoad(): Promise<void> {}

    async saveResult(
        missionId: string,
        todoId: string,
        fullContent: string,
        summary: string,
    ): Promise<{ resultPath: string; summaryPath: string }> {
        const resultPath = `/${missionId}/results/${todoId}/full.md`;
        const summaryPath = `/${missionId}/results/${todoId}/summary.md`;

        await this.vfs.write(this.moduleName, resultPath, fullContent);
        await this.vfs.write(this.moduleName, summaryPath, summary);

        return { resultPath, summaryPath };
    }

    async appendJournal(missionId: string, entry: string): Promise<void> {
        const path = `/${missionId}/journal.md`;
        const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const line = `[${ts}] ${entry}\n`;
        let existing = '';
        try {
            const raw = await this.vfs.read(this.moduleName, path);
            existing = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
        } catch {
            // File doesn't exist yet — first entry
        }
        await this.vfs.write(this.moduleName, path, existing + line);
    }
}
