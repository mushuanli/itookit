/**
 * @file common/interfaces/IMentionProvider.ts
 * @description Extends the generic provider interface with mention-specific features.
 */

import { IAutocompleteProvider } from './IAutocompleteProvider.js';

/**
 * @typedef {object} HoverPreviewData
 * @property {string} title - The title to display in the preview card
 * @property {string} contentHTML - The HTML content to display in the preview
 * @property {string} [icon] - Optional icon HTML or URL
 */

/**
 * @abstract
 * Defines the contract for providing data and interaction logic for the mention feature.
 * It inherits the generic getSuggestions method and adds mention-specific methods
 * such as click handling and hover previews.
 */
export abstract class IMentionProvider extends IAutocompleteProvider {
    /**
     * A unique identifier for the provider, corresponding to the hostname part of an `mdx://` URI.
     * @example 'user', 'file', 'jira-ticket'
     */
    abstract readonly key: string;

    /**
     * The character that triggers autocomplete suggestions for this provider in the editor.
     */
    public triggerChar: string = '@';

    // The getSuggestions(query: string): Promise<Suggestion[]> method is inherited from the parent IAutocompleteProvider.

    // --- Core Method for Headless Processing ---
    async getDataForProcess(targetURL: URL): Promise<any | null> {
        return null;
    }

    // --- Methods for UI Interaction (MDxEditor) ---
    async handleClick(targetURL: URL): Promise<void> {
        console.log(`[IMentionProvider:${this.key}] Clicked:`, targetURL.toString());
    }

    /**
     * Returns preview data for hover tooltips
     * @param {URL} targetURL - The URL to get preview for
     * @returns {Promise<{title: string, contentHTML: string, icon?: string} | null>}
     */
    async getHoverPreview(targetURL: URL): Promise<{title: string, contentHTML: string, icon?: string} | null> {
        return null;
    }

    async getContentForTransclusion(targetURL: URL): Promise<string | null> {
        return null;
    }
}
