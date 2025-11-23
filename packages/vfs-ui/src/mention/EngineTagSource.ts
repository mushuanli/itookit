/**
 * @file vfs-ui/core/EngineTagSource.ts
 * @desc A generic tag autocomplete source that works with any ISessionEngine.
 */
import { IAutocompleteSource, type Suggestion, type ISessionEngine } from '@itookit/common';

export class EngineTagSource extends IAutocompleteSource {
    constructor(private engine: ISessionEngine) {
        super();
    }

    public async getSuggestions(query: string): Promise<Suggestion[]> {
        if (!this.engine.getAllTags) return [];
        try {
            const allTags = await this.engine.getAllTags();
            const lowerQuery = query.toLowerCase();
            const filtered = query 
                ? allTags.filter(t => t.name.toLowerCase().includes(lowerQuery))
                : allTags;
            
            return filtered.map(t => ({
                id: t.name,
                label: t.name,
                type: 'tag',
                color: t.color
            }));
        } catch (e) {
            console.error('Failed to fetch tags', e);
            return [];
        }
    }
}
