/**
 * @file vfslib/src/file-io/File.ts
 * @desc Base implementation of IFile backed by IModuleFS.
 *
 * Performance model (per FileHandle instance lifetime):
 *  - getAssetDirId: at most 1 driver call (cached in _assetDirId)
 *  - getChildren (assetdir listing): at most 1 driver call (cached in _assetIndex)
 *  - putAsset / deleteAsset / writeInternal maintain the index incrementally
 *  - pruneAssets issues a single driver.delete() batch call
 *
 * read() / write() delegate to readRaw() / writeRaw() by default.
 * Subclasses may override read() / write() to assemble / decompose format-specific content.
 */
import type {
    IModuleFS,
    IFile,
    FSNode,
    FSEventType,
    FSEvent,
} from '@itookit/common';
import { FSNotFoundError } from '@itookit/common';
import { toBuffer } from '../utils/encoding';

export class FileHandle implements IFile {
    readonly nodeId: string;

    /**
     * Cached assetdir ID.
     * undefined = not yet fetched; null = no assetdir; string = known ID.
     */
    private _assetDirId: string | null | undefined = undefined;

    /** Cached name→nodeId index for assets in the assetdir. */
    private _assetIndex: Map<string, string> | null = null;

    constructor(
        protected readonly fs: IModuleFS,
        nodeId: string,
    ) {
        this.nodeId = nodeId;
    }

    // ========== Identity ==========

    async getName(): Promise<string> {
        return (await this._requireNode()).name;
    }

    async getPath(): Promise<string> {
        return (await this._requireNode()).path;
    }

    async getNode(): Promise<FSNode> {
        return this._requireNode();
    }

    // ========== Metadata ==========

    async getIcon(): Promise<string> {
        return (await this._requireNode()).icon ?? '';
    }

    async getTags(): Promise<string[]> {
        return [...((await this._requireNode()).tags ?? [])];
    }

    async setTags(tags: string[]): Promise<void> {
        await this.fs.meta.tags.setTags(this.nodeId, tags);
    }

    // ========== High-level content ==========

    async read(): Promise<string | ArrayBuffer> {
        return this.readRaw();
    }

    async write(content: string | ArrayBuffer): Promise<void> {
        await this.writeRaw(content);
    }

    // ========== High-level lifecycle ==========

    async rename(newName: string): Promise<void> {
        await this.fs.driver.rename(this.nodeId, newName);
    }

    async copy(destDirNodeId: string, newName?: string): Promise<IFile> {
        const name = newName ?? await this.getName();
        const content = await this.readRaw();
        const newNode = await this.fs.driver.createFile({
            name,
            parentIdOrPath: destDirNodeId,
            content,
        });
        const newFile = new FileHandle(this.fs, newNode.id);
        const assetNames = await this.listAssets();
        for (const assetName of assetNames) {
            const data = await this.getAsset(assetName);
            if (data) await newFile.putAsset(assetName, data);
        }
        return newFile;
    }

    async move(destDirNodeId: string): Promise<void> {
        const assetDirId = await this._resolveAssetDirId();
        const ids = [this.nodeId];
        if (assetDirId) ids.push(assetDirId);
        await this.fs.driver.move(ids, destDirNodeId);
    }

    async delete(): Promise<void> {
        const assetDirId = await this._resolveAssetDirId();
        const ids = [this.nodeId];
        if (assetDirId) ids.push(assetDirId);
        await this.fs.driver.delete(ids);
    }

    // ========== Low-level: raw main-file access ==========

    async readRaw(): Promise<string | ArrayBuffer> {
        const content = await this.fs.driver.readContent(this.nodeId);
        return typeof content === 'string' ? content : toBuffer(content);
    }

    async writeRaw(content: string | ArrayBuffer): Promise<void> {
        await this.fs.driver.writeContent(this.nodeId, content);
    }

    // ========== Low-level: assetdir internal files ==========

    async readInternal(name: string): Promise<string | ArrayBuffer | null> {
        const index = await this._getAssetIndex();
        if (!index) return null;
        const id = index.get(name);
        if (!id) return null;
        const content = await this.fs.driver.readContent(id);
        return typeof content === 'string' ? content : toBuffer(content);
    }

    async writeInternal(name: string, content: string | ArrayBuffer): Promise<void> {
        const node = await this.fs.meta.assets.putAsset(this.nodeId, name, content);
        if (this._assetDirId === null) this._assetDirId = undefined;
        if (this._assetIndex) this._assetIndex.set(name, node.id);
    }

    async deleteInternal(name: string): Promise<void> {
        await this.deleteAsset(name);
    }

    // ========== Asset operations ==========

    async putAsset(name: string, content: string | ArrayBuffer): Promise<string> {
        await this.writeInternal(name, content);
        return `@asset/${name}`;
    }

    async getAsset(name: string): Promise<ArrayBuffer | null> {
        const index = await this._getAssetIndex();
        if (!index) return null;

        const id = index.get(name);
        if (!id) return null;

        const content = await this.fs.driver.readContent(id);
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

        await this.fs.driver.delete([id]);
        index.delete(name);
    }

    async hasAssetDir(): Promise<boolean> {
        return (await this._resolveAssetDirId()) !== null;
    }

    /**
     * Batch-delete assets not in referencedNames.
     * Issues exactly 1 driver.delete() call regardless of how many assets are pruned.
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
            await this.fs.driver.delete(toDelete.map(([, id]) => id));
            for (const [name] of toDelete) index.delete(name);
        }
        return toDelete.length;
    }

    // ========== Events ==========

    on<E extends FSEventType>(event: E, callback: (event: FSEvent<E>) => void): () => void {
        return this.fs.driver.on(event, callback);
    }

    // ========== Private ==========

    private async _resolveAssetDirId(): Promise<string | null> {
        if (this._assetDirId === undefined) {
            this._assetDirId = await this.fs.meta.assets.getAssetDirId(this.nodeId);
        }
        return this._assetDirId;
    }

    private async _getAssetIndex(): Promise<Map<string, string> | null> {
        const dirId = await this._resolveAssetDirId();
        if (!dirId) return null;

        if (!this._assetIndex) {
            const children = await this.fs.driver.getChildren(dirId) as FSNode[];
            this._assetIndex = new Map(
                children.filter((c) => c.type === 'file').map((c) => [c.name, c.id])
            );
        }
        return this._assetIndex;
    }

    private async _requireNode(): Promise<FSNode> {
        const node = await this.fs.driver.getNode(this.nodeId);
        if (!node) throw new FSNotFoundError(this.nodeId, 'FileHandle.getNode');
        return node;
    }
}

export function createFile(fs: IModuleFS, nodeId: string): IFile {
    return new FileHandle(fs, nodeId);
}
