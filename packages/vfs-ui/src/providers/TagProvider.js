/**
 * @file vfs-ui/providers/TagProvider.js
 */
import { IAutocompleteProvider } from '@itookit/common';

/**
 * @class
 * @implements {IAutocompleteProvider}
 * A concrete tag data source implementation that retrieves tag data from the VFSStore.
 */
export class TagProvider extends IAutocompleteProvider {
    /**
     * @param {import('../stores/VFSStore.js').VFSStore} store 
     */
    constructor(store) {
        super();
        if (!store) {
            throw new Error("TagProvider requires a VFSStore instance.");
        }
        this.store = store;
    }

    /**
     * Retrieves and filters tag suggestions from the VFSStore based on a query.
     * @param {string} query - The search string entered by the user after '#'.
     * @returns {Promise<Array<{id: string, label: string}>>}
     */
    async getSuggestions(query) {
        const state = this.store.getState();
        const allTags = Array.from(state.tags.keys());
        
        const lowerCaseQuery = query.toLowerCase();

        const filteredTags = query 
            ? allTags.filter(tag => tag.toLowerCase().includes(lowerCaseQuery))
            : allTags;

        return filteredTags.map(tag => ({
            id: tag,
            label: tag
        }));
    }
}
