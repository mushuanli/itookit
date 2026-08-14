// @file: llm-ui/services/FileSearchService.ts

import { guessMimeType } from '@itookit/stdio';
import type { IChatEngine } from '@itookit/llm-session';
import type { FileSuggestion } from '../domain/types';

const guessMimeTypeFromName = guessMimeType;

export class FileSearchService {
    constructor(private engine: IChatEngine) {}

    /** Search session-scoped files for @mention suggestions. */
    async search(query: string): Promise<FileSuggestion[]> {
        try {
            const results = await this.engine.search({
                text: query || undefined,
                type: 'file',
                limit: 20,
            });

            return results
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
