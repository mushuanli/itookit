/**
 * @file common/interfaces/IPersistenceAdapter.ts
 * @description Defines the interface that all data persistence adapters must implement.
 */
export abstract class IPersistenceAdapter {
    protected constructor() {
        if (this.constructor === IPersistenceAdapter) {
            throw new Error("IPersistenceAdapter is an interface and cannot be instantiated directly.");
        }
    }

    abstract setItem(key: string, value: any): Promise<void>;
    abstract getItem(key: string): Promise<any | null>;
    abstract removeItem(key: string): Promise<void>;
    abstract clear(): Promise<void>;
}
