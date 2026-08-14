/**
 * @file packages/stdio/src/impl/file-io/File.ts
 * @desc Base IFile implementation backed by IModuleFS.
 *
 * Assetdir sub-files are accessed via file.asset("name") which returns an AssetObj —
 * a lightweight handle for read/write/delete/exists. All sub-files (internal config,
 * message nodes, user attachments) use this same uniform API.
 *
 * Performance:
 *  - Assetdir path fetched once (cached in _assetDirPath)
 *  - Assetdir listing fetched once (cached in _assetIndex)
 *  - put / delete maintain the index incrementally
 */
import type {
    IModuleFS,
    IFile,
    AssetObj,
    FSNode,
    FSEventType,
    FSEvent,
} from '../../protocol';
import { FSNotFoundError } from '../../protocol';
import { toBuffer } from '../../utils/encoding';

// ═══════════════════════════════════════════════════════════════
// InlineAssetObj — lightweight handle for a sub-file in the assetdir
// ═══════════════════════════════════════════════════════════════

class InlineAssetObj implements AssetObj {
    constructor(
        readonly name: string,
        private readonly _file: FileHandle,
    ) {}

    async read(): Promise<ArrayBuffer | null> {
        const index = await this._file._assetIndex();
        if (!index) return null;
        const id = index.get(this.name);
        if (!id) return null;
        const content = await this._file.fs.driver.readContent(id);
        return toBuffer(content as string | ArrayBuffer);
    }

    async readText(): Promise<string | null> {
        const data = await this.read();
        if (!data) return null;
        return new TextDecoder().decode(data);
    }

    async write(content: Uint8Array | ArrayBuffer | string): Promise<string> {
        const buf = typeof content === 'string'
            ? new TextEncoder().encode(content)
            : content instanceof ArrayBuffer ? new Uint8Array(content) : new Uint8Array(content);
        const node = await this._file.fs.meta.assets.putAsset(this._file.nodeId, this.name, buf);
        // Invalidate caches so subsequent reads see the new/updated asset
        this._file._invalidateAssetCache();
        // Update the index in-place if it was already loaded
        const index = await this._file._assetIndex();
        if (index) index.set(this.name, node.path);
        return `@asset/${this.name}`;
    }

    async delete(): Promise<void> {
        const index = await this._file._assetIndex();
        if (!index) return;
        const id = index.get(this.name);
        if (!id) return;
        await this._file.fs.driver.delete([id]);
        index.delete(this.name);
    }

    async exists(): Promise<boolean> {
        const index = await this._file._assetIndex();
        return index !== null && index.has(this.name);
    }
}

// ═══════════════════════════════════════════════════════════════
// FileHandle
// ═══════════════════════════════════════════════════════════════

export class FileHandle implements IFile {
    readonly nodeId: string;

    /** Cached assetdir path. undefined = not fetched; null = no assetdir; string = known. */
    private _assetDirPath: string | null | undefined = undefined;

    /** Cached name→nodeId index for sub-files in the assetdir. */
    private _cachedAssetIndex: Map<string, string> | null = null;

    constructor(
        readonly fs: IModuleFS,
        nodeId: string,
    ) {
        this.nodeId = nodeId;
    }

    // ══ Identity ═══════════════════════════════════════════════

    async getName(): Promise<string> { return (await this._requireNode()).name; }
    async getPath(): Promise<string> { return (await this._requireNode()).path; }
    async getNode(): Promise<FSNode> { return this._requireNode(); }
    async getIcon(): Promise<string> { return (await this._requireNode()).icon ?? ''; }
    async getTags(): Promise<string[]> { return [...((await this._requireNode()).tags ?? [])]; }
    async setTags(tags: string[]): Promise<void> { await this.fs.meta.tags.setTags(this.nodeId, tags); }

    // ══ High-level content ═════════════════════════════════════

    async read(): Promise<string | ArrayBuffer> { return this.readRaw(); }
    async write(content: string | ArrayBuffer): Promise<void> { await this.writeRaw(content); }

    // ══ Lifecycle ══════════════════════════════════════════════

    async rename(newName: string): Promise<void> { await this.fs.driver.rename(this.nodeId, newName); }

    async copy(destDirNodeId: string, newName?: string): Promise<IFile> {
        const name = newName ?? await this.getName();
        const content = await this.readRaw();
        const newNode = await this.fs.driver.createFile({ name, parentPath: destDirNodeId, content });
        const newFile = new FileHandle(this.fs, newNode.path);
        const assetNames = await this.listAssets();
        for (const assetName of assetNames) {
            const data = await this.asset(assetName).read();
            if (data) await newFile.asset(assetName).write(data);
        }
        return newFile;
    }

    async move(destDirNodeId: string): Promise<void> {
        // engine.move already relocates the companion assetdir; passing it
        // explicitly would double-move and throw after the first rename.
        await this.fs.driver.move([this.nodeId], destDirNodeId);
    }

    async delete(): Promise<void> {
        // engine.delete already cascades the companion assetdir.
        await this.fs.driver.delete([this.nodeId]);
    }

    // ══ Low-level: raw main-file ═══════════════════════════════

    async readRaw(): Promise<string | ArrayBuffer> {
        const content = await this.fs.driver.readContent(this.nodeId);
        return typeof content === 'string' ? content : toBuffer(content);
    }

    async writeRaw(content: string | ArrayBuffer): Promise<void> {
        await this.fs.driver.writeContent(this.nodeId, content);
    }

    // ══ Assetdir ═══════════════════════════════════════════════

    asset(name: string): AssetObj {
        return new InlineAssetObj(name, this);
    }

    async listAssets(): Promise<string[]> {
        const index = await this._assetIndex();
        return index ? Array.from(index.keys()) : [];
    }

    async hasAssetDir(): Promise<boolean> {
        return (await this._resolveAssetDirPath()) !== null;
    }

    // ══ Events ═════════════════════════════════════════════════

    on<E extends FSEventType>(event: E, callback: (event: FSEvent<E>) => void): () => void {
        return this.fs.driver.on(event, callback);
    }

    // ══ Internal (exposed for InlineAssetObj and subclasses) ══

    /** @internal — resolve the assetdir path on demand, caching the result */
    async _resolveAssetDirPath(): Promise<string | null> {
        if (this._assetDirPath === undefined) {
            this._assetDirPath = await this.fs.meta.assets.getAssetDirPath(this.nodeId);
        }
        return this._assetDirPath;
    }

    /** @internal — fetch and cache the assetdir name→path index */
    async _assetIndex(): Promise<Map<string, string> | null> {
        const dirPath = await this._resolveAssetDirPath();
        if (!dirPath) return null;
        if (!this._cachedAssetIndex) {
            const children = await this.fs.driver.getChildren(dirPath) as FSNode[];
            this._cachedAssetIndex = new Map(
                children.filter(c => c.type === 'file').map(c => [c.name, c.path])
            );
        }
        return this._cachedAssetIndex;
    }

    /** @internal — invalidate cached assetdir info after a write that creates one */
    _invalidateAssetCache(): void {
        this._assetDirPath = undefined;
        this._cachedAssetIndex = null;
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
