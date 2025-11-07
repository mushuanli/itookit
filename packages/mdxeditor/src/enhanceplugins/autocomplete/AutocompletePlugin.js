/**
 * @file mdxeditor/enhanceplugins/autocomplete/AutocompletePlugin.js
 * @description A generic, configurable autocomplete plugin for CodeMirror.
 */

import { autocompletion } from "@codemirror/autocomplete";

export class AutocompletePlugin {
    name = 'feature:autocomplete';

    /**
     * @param {object} options
     * @param {import('./autocomplete.types.js').AutocompleteSourceOptions[]} options.sources - An array of configurations for one or more autocomplete data sources.
     */
    // [订正] 为 options 的默认值添加 sources 属性，以满足类型要求。
    constructor(options = { sources: [] }) {
        this.sources = options.sources || [];
    }

    /**
     * @param {import('../../core/plugin.js').PluginContext} context
     */
    install(context) {
        // Override CodeMirror's default autocompletion with our multi-source logic
        const autocompleteExtension = autocompletion({
            override: [this.createAutocompleteSource()]
        });
        context.registerCodeMirrorExtension(autocompleteExtension);
    }

    /**
     * Creates a CodeMirror autocompletion source function.
     * @returns {import('@codemirror/autocomplete').CompletionSource}
     */
    createAutocompleteSource = () => {
        const self = this;
        return async (ctx) => {
            // Dynamically build a regex to match any of the configured trigger characters
            const triggerChars = self.sources.map(s => s.triggerChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
            if (!triggerChars) return null;
            
            const triggerRegex = new RegExp(`[${triggerChars}](\\w*)$`);
            const match = ctx.matchBefore(triggerRegex);

            if (!match) {
                return null;
            }

            const trigger = match.text[0];
            const query = match.text.substring(1);

            // Find the source configuration that matches the current trigger character
            const sourceConfig = self.sources.find(s => s.triggerChar === trigger);
            if (!sourceConfig) {
                return null;
            }

            try {
                const suggestions = await sourceConfig.provider.getSuggestions(query);

                return {
                    from: match.from,
                    options: suggestions.map(suggestion => ({
                        label: suggestion.label,
                        type: sourceConfig.completionType || 'autocomplete-item',
                        apply: (view) => {
                            // Use the configured template function to generate the text to be inserted
                            const textToInsert = sourceConfig.applyTemplate(suggestion);
                            view.dispatch({
                                changes: { from: match.from, to: ctx.pos, insert: textToInsert },
                                selection: { anchor: match.from + textToInsert.length } // Move the cursor after the inserted content
                            });
                        }
                    })),
                    // We handle filtering ourselves, so disable CodeMirror's built-in filtering
                    filter: false,
                };
            } catch (error) {
                console.error(`[AutocompletePlugin] Provider for trigger '${trigger}' failed to get suggestions:`, error);
                return null;
            }
        };
    }
}
