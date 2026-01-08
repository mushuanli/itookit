/**
 * @file vfs-ui/mention/EngineTagSource.ts
 * @desc A generic tag autocomplete source that works with any ISessionEngine.
 */
import { IAutocompleteSource, type Suggestion, type ISessionEngine } from '@itookit/common';

interface TagData {
    name: string;
    color?: string;
    refCount?: number;
}

export class EngineTagSource extends IAutocompleteSource {
    constructor(private engine: ISessionEngine) {
        super();
    }

    async getSuggestions(query: string): Promise<Suggestion[]> {
        if (!this.engine.getAllTags) return [];

        try {
            const tags = (await this.engine.getAllTags()) as TagData[];
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
