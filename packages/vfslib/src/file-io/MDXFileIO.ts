/**
 * @file vfslib/src/file-io/MDXFileIO.ts
 * @desc MDX/Markdown file handle implementing IMDXFileIO.
 *
 * Extends FileIO to reuse all base asset operations.
 * Adds MDX-specific capabilities:
 *  - @asset/ reference resolution to Blob URLs (cached per instance, parallel fetch)
 *  - Referenced-asset extraction from Markdown content
 *  - Automatic pruning of unreferenced assets
 */
import type { ISessionEngine, IMDXFileIO } from '@itookit/common';
import { guessMimeType } from '@itookit/common';
import { FileIO } from './FileIO';

const ASSET_REF_REGEX = /@asset\/([^\s)"']+)/g;

export class MDXFileIO extends FileIO implements IMDXFileIO {
    /** Blob URLs keyed by asset name — reused across renders, revoked on destroy(). */
    private readonly _blobUrls = new Map<string, string>();

    constructor(engine: ISessionEngine, nodeId: string) {
        super(engine, nodeId);
    }

    // ========== IMDXFileIO ==========

    extractReferencedAssets(content: string): string[] {
        const names: string[] = [];
        const regex = new RegExp(ASSET_REF_REGEX.source, 'g');
        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
            names.push(match[1]);
        }
        return names;
    }

    async resolveAssetReferences(content: string): Promise<string> {
        const names = this.extractReferencedAssets(content);
        if (names.length === 0) return content;

        // Deduplicate before fetching to avoid redundant concurrent requests
        // for the same asset name appearing multiple times in the document.
        const uniqueNames = [...new Set(names)];
        const entries = await Promise.all(
            uniqueNames.map(async (name) => [name, await this._getOrCreateBlobUrl(name)] as const)
        );

        let result = content;
        for (const [name, blobUrl] of entries) {
            if (blobUrl) result = result.replaceAll(`@asset/${name}`, blobUrl);
        }
        return result;
    }

    async pruneUnusedAssets(): Promise<number> {
        const content = await this.read();
        const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
        const refs = this.extractReferencedAssets(text);
        return (await this.pruneAssets(refs)) ?? 0;
    }

    destroy(): void {
        this._blobUrls.forEach((url) => URL.revokeObjectURL(url));
        this._blobUrls.clear();
    }

    // ========== Private ==========

    private async _getOrCreateBlobUrl(name: string): Promise<string | null> {
        if (this._blobUrls.has(name)) return this._blobUrls.get(name)!;

        const data = await this.getAsset(name);
        if (!data) return null;

        const url = URL.createObjectURL(new Blob([data], { type: guessMimeType(name) }));
        this._blobUrls.set(name, url);
        return url;
    }
}

export function createMDXFileIO(engine: ISessionEngine, nodeId: string): IMDXFileIO {
    return new MDXFileIO(engine, nodeId);
}
