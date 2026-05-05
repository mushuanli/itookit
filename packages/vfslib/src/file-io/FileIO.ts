/**
 * @file vfslib/src/file-io/FileIO.ts
 * @desc Base implementation of IFileIO wrapping an ISessionEngine.
 *
 * Performance model (per FileIO instance lifetime):
 *  - getAssetDirectoryId: at most 1 engine call (cached in _assetDirId)
 *  - getChildren (assetdir listing): at most 1 engine call (cached in _assetIndex)
 *  - putAsset / deleteAsset maintain the index incrementally
 *  - pruneAssets issues a single engine.delete() batch call
 */
import type {
    ISessionEngine,
    EngineNode,
    EngineEventType,
    EngineEvent,
    IFileIO,
} from '@itookit/common';
import { toBuffer } from '../utils/encoding';

export class FileIO implements IFileIO {
    readonly nodeId: string;

    /**
     * Cached assetdir ID.
     * undefined = not yet fetched; null = no assetdir; string = known ID.
     */
    private _assetDirId: string | null | undefined = undefined;

    /** Cached name→nodeId index for assets in the assetdir. */
    private _assetIndex: Map<string, string> | null = null;

    constructor(
        protected readonly engine: ISessionEngine,
        nodeId: string,
    ) {
        this.nodeId = nodeId;
    }

    async getName(): Promise<string> {
        return (await this._requireNode()).name;
    }

    async getPath(): Promise<string> {
        return (await this._requireNode()).path;
    }

    async getNode(): Promise<EngineNode> {
        return this._requireNode();
    }

    // ========== Primary content ==========

    async read(): Promise<string | ArrayBuffer> {
        return this.engine.readContent(this.nodeId);
    }

    async write(content: string | ArrayBuffer): Promise<void> {
        await this.engine.writeContent(this.nodeId, content);
    }

    // ========== Asset operations ==========

    async putAsset(name: string, content: string | ArrayBuffer): Promise<string> {
        await this._writeRawAsset(name, content);
        return `@asset/${name}`;
    }

    async getAsset(name: string): Promise<ArrayBuffer | null> {
        const index = await this._getAssetIndex();
        if (!index) return null;

        const id = index.get(name);
        if (!id) return null;

        const content = await this.engine.readContent(id);
        return toBuffer(content as string | ArrayBuffer);
    }

    async listAssets(): Promise<string[]> {
        const index = await this._getAssetIndex();
        return index ? Array.from(index.keys()) : [];
    }

    async deleteAsset(name: string): Promise<void> {
        const index = await this._getAssetIndex();
        if (!index) return;

        const id = index.get(name);
        if (!id) return;

        await this.engine.delete([id]);
        index.delete(name);
    }

    async hasAssetDir(): Promise<boolean> {
        return (await this._resolveAssetDirId()) !== null;
    }

    // ========== Lifecycle ==========

    async rename(newName: string): Promise<void> {
        await this.engine.rename(this.nodeId, newName);
    }

    /**
     * Batch-delete assets not in referencedNames.
     * Issues exactly 1 engine.delete() call regardless of how many assets are pruned.
     */
    async pruneAssets(referencedNames: string[]): Promise<number | null> {
        const index = await this._getAssetIndex();
        if (!index) return null;

        const refSet = new Set(referencedNames);
        const toDelete: Array<[name: string, id: string]> = [];
        for (const [name, id] of index) {
            if (!refSet.has(name)) toDelete.push([name, id]);
        }

        if (toDelete.length > 0) {
            await this.engine.delete(toDelete.map(([, id]) => id));
            for (const [name] of toDelete) index.delete(name);
        }
        return toDelete.length;
    }

    // ========== Events ==========

    on(event: EngineEventType, callback: (event: EngineEvent) => void): () => void {
        return this.engine.on(event, callback);
    }

    // ========== Protected helpers ==========

    /**
     * Write a raw file into the assetdir without returning an @asset/ reference.
     * Subclasses use this for internal storage files (e.g. message nodes, settings)
     * that are not user-facing embedded assets.
     */
    protected async _writeRawAsset(name: string, content: string | ArrayBuffer): Promise<void> {
        const node = await this.engine.createAsset(this.nodeId, name, content);
        if (this._assetDirId === null) this._assetDirId = undefined;
        if (this._assetIndex) this._assetIndex.set(name, node.id);
    }

    // ========== Private ==========

    private async _resolveAssetDirId(): Promise<string | null> {
        if (this._assetDirId === undefined) {
            this._assetDirId = await this.engine.getAssetDirectoryId(this.nodeId);
        }
        return this._assetDirId;
    }

    private async _getAssetIndex(): Promise<Map<string, string> | null> {
        const dirId = await this._resolveAssetDirId();
        if (!dirId) return null;

        if (!this._assetIndex) {
            const children = await this.engine.getChildren(dirId);
            this._assetIndex = new Map(
                children.filter((c) => c.type === 'file').map((c) => [c.name, c.id])
            );
        }
        return this._assetIndex;
    }

    private async _requireNode(): Promise<EngineNode> {
        const node = await this.engine.getNode(this.nodeId);
        if (!node) throw new Error(`FileIO: node not found: ${this.nodeId}`);
        return node;
    }
}

export function createFileIO(engine: ISessionEngine, nodeId: string): IFileIO {
    return new FileIO(engine, nodeId);
}
