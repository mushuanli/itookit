// #mdx/plugins/tags/TagProvider.js

import { IAutocompleteProvider } from '../autocomplete/IAutocompleteProvider.js';

/**
 * Provides tag suggestions by calling a provided function.
 * This class is completely decoupled from any specific state management library.
 * @implements {IAutocompleteProvider}
 */
export class TagProvider extends IAutocompleteProvider {
    /**
     * @param {object} options
     * @param {() => Promise<string[]>} options.getTags - A function that returns a promise resolving to an array of all available tag strings.
     */
    constructor({ getTags }) {
        super();
        if (typeof getTags !== 'function') {
            throw new Error("TagProvider requires a 'getTags' function.");
        }
        /** @private */
        this.getTags = getTags;
    }

    /**
     * Gets tag suggestions based on a query.
     * @param {string} query - The search string typed by the user.
     * @returns {Promise<Array<{id: string, label: string}>>}
     */
    async getSuggestions(query) {
        try {
            const allTags = await this.getTags();
            const lowerCaseQuery = query.toLowerCase();

            const filteredTags = allTags.filter(tag => 
                tag.toLowerCase().includes(lowerCaseQuery)
            );

            // Map to the format required by the autocomplete system
            return filteredTags.map(tag => ({
                id: tag,
                label: tag,
            }));
        } catch (error) {
            console.error("[TagProvider] Failed to get tags from the provided 'getTags' function:", error);
            return []; // Return an empty array on failure
        }
    }
}
