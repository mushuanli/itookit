/**
 * @file mdxeditor/enhanceplugins/tags/TagPlugin.js
 */

import { AutocompletePlugin } from '../autocomplete/AutocompletePlugin.js';
import { TagProvider } from './TagProvider.js';

/**
 * A plugin that provides autocompletion for tags using the '#' trigger.
 * It is configured with a function to fetch tags, making it data-source agnostic.
 */
export class TagPlugin {
    name = 'feature:tags';

    /**
     * @param {object} options
     * @param {() => Promise<string[]>} options.getTags - The function to fetch all available tags.
     */
    constructor({ getTags }) {
        // 1. Instantiate our data provider, injecting the dependency.
        const tagProvider = new TagProvider({ getTags });

        // 2. Create the source configuration for the generic AutocompletePlugin
        const tagSource = {
            triggerChar: '#',
            provider: tagProvider,
            completionType: 'completion-tag', // For CSS styling
            
            /**
             * Defines what text gets inserted when a user selects a suggestion.
             * @param {{id: string, label: string}} item The selected suggestion object.
             * @returns {string} The text to insert.
             */
            applyTemplate: (item) => `${item.label} `, // Insert the tag and a space
        };
        
        // 3. Instantiate the generic AutocompletePlugin with our tag source
        this.autocompletePlugin = new AutocompletePlugin({ sources: [tagSource] });
    }

    /**
     * @param {import('../../core/plugin.js').PluginContext} context
     */
    install(context) {
        // The TagPlugin's only job is to install its pre-configured AutocompletePlugin instance.
        this.autocompletePlugin.install(context);
    }
}
