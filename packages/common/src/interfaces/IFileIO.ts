/**
 * @file common/interfaces/IFileIO.ts
 * @desc Universal file handle — treats a file and its companion assetdir as a single unit.
 *
 * Implementation guarantees:
 *  - Writing an asset automatically creates the assetdir if it does not exist
 *  - Deleting the file cascades to the assetdir
 *  - Renaming the file keeps the assetdir in sync
 *
 * Create via factory: createFileIO(engine: ISessionEngine, nodeId: string): IFileIO
 */
import type { EngineNode, EngineEventType, EngineEvent } from './ISessionEngine';

export interface IFileIO {
    // ========== Identity ==========
    readonly nodeId: string;
    getName(): Promise<string>;
    getPath(): Promise<string>;
    getNode(): Promise<EngineNode>;

    // ========== Primary content ==========
    /** Read the file's main content */
    read(): Promise<string | ArrayBuffer>;
    /** Overwrite the file's main content */
    write(content: string | ArrayBuffer): Promise<void>;

    // ========== Asset operations (assetdir abstraction) ==========
    /**
     * Write an asset to the companion assetdir.
     * The assetdir is created automatically when it does not exist.
     * @returns Reference string for embedding in documents (e.g. "@asset/image.png")
     */
    putAsset(name: string, content: string | ArrayBuffer): Promise<string>;
    /** Read asset content; returns null when the asset does not exist */
    getAsset(name: string): Promise<ArrayBuffer | null>;
    /** List all asset filenames */
    listAssets(): Promise<string[]>;
    /** Delete a single asset */
    deleteAsset(name: string): Promise<void>;
    /** Returns true when this file has a companion assetdir */
    hasAssetDir(): Promise<boolean>;

    // ========== Lifecycle ==========
    /** Rename the file; the companion assetdir is renamed in sync */
    rename(newName: string): Promise<void>;
    /**
     * Remove assets whose names are not in referencedNames.
     * @returns Number of assets deleted, or null when there is no assetdir
     */
    pruneAssets(referencedNames: string[]): Promise<number | null>;

    // ========== Events ==========
    on(event: EngineEventType, callback: (event: EngineEvent) => void): () => void;
}
