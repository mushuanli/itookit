/**
 * @file common/interfaces/IMentionProvider.ts
 * @description Extends the generic provider interface with mention-specific features.
 */

import { IAutocompleteProvider } from './IAutocompleteProvider';

/** 
 * UPDATE: Replaced JSDoc @typedef with a native TypeScript interface for strong typing.
 * Defines the data structure for hover preview cards.
 */
export interface HoverPreviewData {
    title: string;
    contentHTML: string;
    icon?: string;
}

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
     * @param targetURL - The URL to get preview for
     * UPDATE: The return type now uses the HoverPreviewData interface.
     */
    async getHoverPreview(targetURL: URL): Promise<HoverPreviewData | null> {
        return null;
    }

    async getContentForTransclusion(targetURL: URL): Promise<string | null> {
        return null;
    }
}
