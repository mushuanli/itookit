/**
 * @file vfs-ui/src/mention/autocomplete-source.ts
 * Generic autocomplete / mention source interfaces — vfs-ui internal.
 * HoverPreviewData is defined in @itookit/common and re-exported here for convenience.
 */

import type { HoverPreviewData } from '@itookit/common';

export type { HoverPreviewData };

export interface Suggestion {
    id: string | number;
    label: string;
    type?: string;
    [key: string]: any;
}

export abstract class IAutocompleteSource {
    constructor() {
        if (this.constructor === IAutocompleteSource) {
            throw new Error('IAutocompleteSource is an interface and cannot be instantiated directly.');
        }
    }
    abstract getSuggestions(query: string): Promise<Suggestion[]>;
}

export abstract class IMentionSource extends IAutocompleteSource {
    abstract readonly key: string;
    public triggerChar: string = '@';

    async getDataForProcess(_targetURL: URL): Promise<any | null> { return null; }
    async handleClick(_targetURL: URL): Promise<void> {}
    async getHoverPreview(_uri: string): Promise<HoverPreviewData | null> { return null; }
    async getContentForTransclusion(_targetURL: URL): Promise<string | null> { return null; }
}
