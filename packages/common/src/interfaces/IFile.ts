/**
 * @file common/interfaces/IFile.ts
 * @desc Universal file handle — treats a file and its companion assetdir as a single unit.
 *
 * Layer contract:
 *  - High-level ops (read/write/copy/move/delete/rename): fully transparent to callers;
 *    subclasses may override read/write to assemble/disassemble format-specific content.
 *  - Low-level raw ops (readRaw/writeRaw): always access the main file's literal bytes,
 *    bypassing any subclass format logic. Use these to build or inspect the underlying index.
 *  - Internal file ops (readInternal/writeInternal/deleteInternal): access non-user-visible
 *    files inside the companion assetdir (e.g. message nodes, settings.yaml).
 *  - Asset ops (putAsset/getAsset/…): user-facing embedded attachments; return @asset/<name> refs.
 *
 * Implementation guarantees:
 *  - Writing an asset automatically creates the assetdir if it does not exist.
 *  - delete() cascades to the assetdir.
 *  - move() / rename() keep the assetdir in sync.
 *
 * Create via: IModuleFS.openFile(nodeId) or factory functions createFile / createMDXFile / createChatFile
 */
import type { FSNode } from './fs/core/types';
import type { FSEventType, FSEvent } from './fs/core/events';

export interface IFile {
    // ========== Identity ==========
    readonly nodeId: string;
    getName(): Promise<string>;
    getPath(): Promise<string>;
    getNode(): Promise<FSNode>;

    // ========== Metadata ==========
    /** Returns node.icon, or empty string when none is set */
    getIcon(): Promise<string>;
    /** Returns node.tags, or empty array when none are set */
    getTags(): Promise<string[]>;
    /** Replace node tags (full replacement) */
    setTags(tags: string[]): Promise<void>;

    // ========== High-level content (subclasses may override) ==========
    /**
     * Read logical file content.
     * Base implementation delegates to readRaw().
     * Subclasses may override: ChatFileHandle assembles all messages into markdown;
     * MDXFile returns MDX text as-is.
     */
    read(): Promise<string | ArrayBuffer>;
    /**
     * Write logical file content.
     * Base implementation delegates to writeRaw().
     * Subclasses may override to parse and decompose content into the internal format.
     */
    write(content: string | ArrayBuffer): Promise<void>;

    // ========== High-level lifecycle ==========
    /** Rename the file; companion assetdir is renamed in sync */
    rename(newName: string): Promise<void>;
    /**
     * Copy to destination directory.
     * Copies main content and all user assets.
     * @returns IFile handle for the new copy
     */
    copy(destDirNodeId: string, newName?: string): Promise<IFile>;
    /** Move to destination directory; companion assetdir moves in sync */
    move(destDirNodeId: string): Promise<void>;
    /** Delete this file and its companion assetdir (cascade) */
    delete(): Promise<void>;

    // ========== Low-level: raw main-file access (index layer) ==========
    /**
     * Read the main file's literal bytes — no format assembly.
     * For ChatFileHandle: returns the raw manifest JSON.
     * Use this to inspect or directly manipulate the underlying index/manifest.
     */
    readRaw(): Promise<string | ArrayBuffer>;
    /** Write the main file's literal bytes — no format transformation */
    writeRaw(content: string | ArrayBuffer): Promise<void>;

    // ========== Low-level: assetdir internal files ==========
    /**
     * Read a non-user-visible internal file from the companion assetdir
     * (e.g. <msgId>.chat, settings.yaml).
     * Returns null when the file does not exist.
     */
    readInternal(name: string): Promise<string | ArrayBuffer | null>;
    /**
     * Write a non-user-visible internal file into the companion assetdir.
     * The assetdir is created automatically when it does not exist.
     */
    writeInternal(name: string, content: string | ArrayBuffer): Promise<void>;
    /** Delete an internal file from the companion assetdir */
    deleteInternal(name: string): Promise<void>;

    // ========== Asset operations (user-facing attachments) ==========
    /**
     * Write a user asset to the companion assetdir.
     * The assetdir is created automatically when it does not exist.
     * @returns Reference string for embedding in documents (e.g. "@asset/image.png")
     */
    putAsset(name: string, content: string | ArrayBuffer): Promise<string>;
    /** Read asset content; returns null when the asset does not exist */
    getAsset(name: string): Promise<ArrayBuffer | null>;
    /** List all user asset filenames */
    listAssets(): Promise<string[]>;
    /** Delete a single user asset */
    deleteAsset(name: string): Promise<void>;
    /** Returns true when this file has a companion assetdir */
    hasAssetDir(): Promise<boolean>;
    /**
     * Remove assets whose names are not in referencedNames.
     * @returns Number of assets deleted, or null when there is no assetdir
     */
    pruneAssets(referencedNames: string[]): Promise<number | null>;

    // ========== Events ==========
    on<E extends FSEventType>(event: E, callback: (event: FSEvent<E>) => void): () => void;
}
