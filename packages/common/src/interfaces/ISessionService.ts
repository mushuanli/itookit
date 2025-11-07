/**
 * @file common/interfaces/ISessionService.ts
 * @description Defines the interface that the SessionService must expose to external modules (like Mention Providers).
 */
export abstract class ISessionService {
    protected constructor() {
        if (this.constructor === ISessionService) {
            throw new Error("ISessionService is an interface and cannot be instantiated directly.");
        }
    }

    /**
     * Finds any type of item (session or folder) by its ID.
     * @param itemId - The unique ID of the item.
     * @returns The found item object, or undefined.
     */
    abstract findItemById(itemId: string): object | undefined;

    /**
     * Updates an item's metadata.
     * @param itemId - The ID of the item to update.
     * @param metadataUpdates - An object containing the metadata fields to update.
     */
    abstract updateItemMetadata(itemId: string, metadataUpdates: Record<string, any>): Promise<void>;

    /**
     * Gets a flattened list of all folders.
     */
    abstract getAllFolders(): Promise<object[]>;
    
    /**
     * Gets a flattened list of all files (sessions).
     */
    abstract getAllFiles(): Promise<object[]>;
    
    /**
     * Creates a new session.
     * @param options - Options for creating the session.
     * @returns The newly created session object.
     */
    abstract createSession(options: { title?: string; content?: string; parentId?: string }): Promise<object>;
}
