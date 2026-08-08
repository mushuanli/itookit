/**
 * @file vfs-ui/mention/EngineTagSource.ts
 * @desc A generic tag autocomplete source that works with any IFSEngine.
 */
import { IAutocompleteSource, type Suggestion } from './autocomplete-source';
import type { IModuleFS } from '@itookit/stdio';

interface TagData {
    name: string;
    color?: string;
    refCount?: number;
}

export class EngineTagSource extends IAutocompleteSource {
    constructor(private engine: IModuleFS) {
        super();
    }

    async getSuggestions(query: string): Promise<Suggestion[]> {
        const tagsOps = this.engine.meta.tags;
        if (!tagsOps) return [];

        try {
            const tags = (await tagsOps.getAllTags()) as TagData[];
            const lowerQuery = query.toLowerCase();

            return tags
                .filter(t => !query || t.name.toLowerCase().includes(lowerQuery))
                .sort((a, b) => (b.refCount || 0) - (a.refCount || 0) || a.name.localeCompare(b.name))
                .map(t => ({
                    id: t.name,
                    label: t.name,
                    type: 'tag',
                    color: t.color,
                    extra: { count: t.refCount }
                }));
        } catch (e) {
            console.error('Failed to fetch tags', e);
            return [];
        }
    }
}
