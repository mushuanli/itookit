// @file: llm-ui/services/FileSearchService.ts

import { guessMimeType } from '@itookit/vfs-core';
import type { IFileSystem } from '@itookit/vfs-core';
import type { FileSuggestion } from '../domain/types';

const guessMimeTypeFromName = guessMimeType;

export class FileSearchService {
    constructor(private fs?: IFileSystem) {}

    /** Search session-scoped files for @mention suggestions. */
    async search(query: string): Promise<FileSuggestion[]> {
        try {
            if (!this.fs) return [];
            const results = await this.fs.driver.search({
                text: query || undefined,
                type: 'file',
                limit: 20,
            });

            return results.nodes
                .filter((n) => n.type === 'file')
                .map((n) => ({
                    name: n.name,
                    path: n.path.startsWith('/') ? `.${n.path}` : `./${n.path}`,
                    mimeType: guessMimeTypeFromName(n.name),
                    size: n.size,
                }));
        } catch {
            return [];
        }
    }
}
