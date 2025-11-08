/**
 * @itookit/vfs-core TypeScript Definitions
 */

// ========== Core Types ==========

export interface VNodeOptions {
    id?: string;
    type: 'file' | 'directory' | 'symlink';
    module: string;
    name: string;
    parent?: string | null;
    contentType?: string;
    providers?: string[];
    meta?: VNodeMeta;
    contentRef?: string | null;
}

export interface VNodeMeta {
    size?: number;
    createdAt?: Date;
    modifiedAt?: Date;
    accessedAt?: Date;
    permissions?: string;
    owner?: string | null;
    tags?: string[];
    [key: string]: any;
}

export class VNode {
    id: string;
    type: 'file' | 'directory' | 'symlink';
    module: string;
    name: string;
    parent: string | null;
    contentType: string;
    providers: string[];
    meta: VNodeMeta;
    contentRef: string | null;
    
    constructor(options: VNodeOptions);
    
    isDirectory(): boolean;
    isFile(): boolean;
    isSymlink(): boolean;
    invalidateCache(): void;
    touch(): void;
    markModified(): void;
    toJSON(): object;
    clone(): VNode;
    getStat(): VNodeStat;
    
    static fromJSON(data: object): VNode;
}

export interface VNodeStat {
    id: string;
    type: 'file' | 'directory' | 'symlink';
    name: string;
    size: number;
    createdAt: Date;
    modifiedAt: Date;
    accessedAt: Date;
    permissions: string;
    contentType: string;
}

// ========== VFSCore ==========

export interface VFSManagerOptions {
    storage?: object;
    providers?: ContentProvider[];
    defaults?: {
        modules?: string[];
        [key: string]: any;
    };
}

export interface ReadResult {
    content: string;
    metadata: object;
}

export interface CreateFileOptions {
    contentType?: string;
    meta?: object;
}

export interface SearchCriteria {
    contentType?: string;
    type?: 'file' | 'directory';
    name?: string;
    tags?: string[];
}

export class VFSCore {
    storage: VFSStorage;
    vfs: VFS;
    events: EventBus;
    providerRegistry: ProviderRegistry;
    moduleRegistry: ModuleRegistry;
    initialized: boolean;
    
    static getInstance(): VFSCore;
    
    init(options?: VFSManagerOptions): Promise<void>;
    shutdown(): Promise<void>;
    
    // Module Management
    mount(name: string, options?: object): Promise<ModuleInfo>;
    unmount(name: string): Promise<void>;
    getModule(name: string): ModuleInfo | null;
    listModules(): string[];
    
    // Provider Management
    registerProvider(provider: ContentProvider): void;
    unregisterProvider(name: string): void;
    getProvider(name: string): ContentProvider | undefined;
    listProviders(): string[];
    
    // File Operations
    createFile(module: string, path: string, content?: string, options?: CreateFileOptions): Promise<VNode>;
    createDirectory(module: string, path: string, options?: object): Promise<VNode>;
    read(nodeId: string, options?: object): Promise<ReadResult>;
    write(nodeId: string, content: string, options?: object): Promise<VNode>;
    unlink(nodeId: string, options?: object): Promise<{ removedNodeId: string; allRemovedIds: string[] }>;
    move(nodeId: string, newPath: string): Promise<VNode>;
    copy(sourceId: string, targetPath: string): Promise<VNode>;
    readdir(nodeId: string, options?: object): Promise<VNode[]>;
    stat(nodeId: string): Promise<object>;
    getTree(module: string): Promise<VNode[]>;
    
    // Event Subscription
    on(event: string, callback: (data: any) => void): () => void;
    once(event: string, callback: (data: any) => void): () => void;
    off(event: string, callback: (data: any) => void): void;
    
    // Utilities
    getStats(): Promise<SystemStats>;
    exportModule(module: string): Promise<object>;
    importModule(data: object): Promise<void>;
    search(module: string, criteria: SearchCriteria): Promise<VNode[]>;
}

export function getVFSManager(): VFSCore;

// ========== Providers ==========

export interface ProviderOptions {
    priority?: number;
    capabilities?: string[];
}

export interface ReadResult {
    content: string | null;
    metadata: object;
}

export interface WriteResult {
    updatedContent: string;
    derivedData: object;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

export abstract class ContentProvider {
    name: string;
    priority: number;
    capabilities: string[];
    enabled: boolean;
    
    constructor(name: string, options?: ProviderOptions);
    
    canHandle(vnode: VNode): boolean;
    read(vnode: VNode, options?: object): Promise<ReadResult>;
    write(vnode: VNode, content: string, transaction: any): Promise<WriteResult>;
    validate(vnode: VNode, content: string): Promise<ValidationResult>;
    cleanup(vnode: VNode, transaction: any): Promise<void>;
    getStats(vnode: VNode): Promise<object>;
    onMove(vnode: VNode, oldPath: string, newPath: string, transaction: any): Promise<void>;
    onCopy(sourceVNode: VNode, targetVNode: VNode, transaction: any): Promise<void>;
    onEnable(): Promise<void>;
    onDisable(): Promise<void>;
    hasCapability(capability: string): boolean;
}

export class PlainTextProvider extends ContentProvider {}
export class SRSProvider extends ContentProvider {}
export class TaskProvider extends ContentProvider {}
export class AgentProvider extends ContentProvider {}
export class LinkProvider extends ContentProvider {}
export class CompositeProvider extends ContentProvider {}

export class ProviderFactory {
    static createBuiltInProviders(deps: { storage: VFSStorage; eventBus: EventBus }): ContentProvider[];
    static createMarkdownProvider(deps: { storage: VFSStorage; eventBus: EventBus }): CompositeProvider;
}

// ========== Registry ==========

export class ProviderRegistry {
    register(provider: ContentProvider): void;
    unregister(name: string): void;
    get(name: string): ContentProvider | undefined;
    has(name: string): boolean;
    getProvidersForNode(vnode: VNode): ContentProvider[];
    mapType(contentType: string, providerNames: string[]): void;
    getDefaultProviders(contentType: string): string[];
    getProviderNames(): string[];
    getAllProviders(): ContentProvider[];
    onHook(event: string, callback: (data: any) => void): () => void;
}

export class ModuleInfo {
    name: string;
    rootId: string | null;
    description: string;
    createdAt: Date;
    meta: object;
    
    constructor(name: string, options?: object);
    toJSON(): object;
    static fromJSON(data: object): ModuleInfo;
}

export class ModuleRegistry {
    register(name: string, options?: object): ModuleInfo;
    unregister(name: string): void;
    get(name: string): ModuleInfo | undefined;
    has(name: string): boolean;
    getModuleNames(): string[];
    update(name: string, updates: object): void;
}

// ========== Storage ==========

export const VFS_STORES: {
    VNODES: string;
    CONTENTS: string;
    MODULES: string;
    SRS_CLOZES: string;
    TASKS: string;
    AGENTS: string;
    LINKS: string;
    TAGS: string;
    NODE_TAGS: string;
};

export class VFSStorage {
    constructor(options?: object);
    connect(): Promise<void>;
    beginTransaction(storeNames?: string[], mode?: IDBTransactionMode): Promise<Transaction>;
    
    // VNode operations
    saveVNode(vnode: VNode, transaction?: Transaction): Promise<void>;
    loadVNode(nodeId: string): Promise<VNode | null>;
    deleteVNode(nodeId: string, transaction?: Transaction): Promise<void>;
    getNodeIdByPath(module: string, path: string): Promise<string | null>;
    getChildren(parentId: string): Promise<VNode[]>;
    loadVNodes(nodeIds: string[]): Promise<VNode[]>;
    
    // Content operations
    saveContent(nodeId: string, content: string, transaction?: Transaction): Promise<string>;
    loadContent(contentRef: string): Promise<string>;
    updateContent(contentRef: string, content: string, transaction?: Transaction): Promise<void>;
    deleteContent(contentRef: string, transaction?: Transaction): Promise<void>;
    
    // Module operations
    getModuleRoot(moduleName: string): Promise<VNode | null>;
    getModuleNodes(moduleName: string): Promise<VNode[]>;
}

export class Database {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getTransaction(stores: string | string[], mode?: IDBTransactionMode): Promise<IDBTransaction>;
    getAllByIndex(storeName: string, indexName: string, query: any): Promise<any[]>;
}

// ========== Utils ==========

export class EventBus {
    on(event: string, callback: (data: any) => void): () => void;
    once(event: string, callback: (data: any) => void): () => void;
    off(event: string, callback: (data: any) => void): void;
    emit(event: string, data: any): void;
    clear(event?: string): void;
    listenerCount(event: string): number;
    eventNames(): string[];
}

export class Cache {
    constructor(maxSize?: number);
    get(key: string): any;
    set(key: string, value: any): void;
    has(key: string): boolean;
    delete(key: string): void;
    invalidate(key: string): void;
    clear(): void;
    size(): number;
    keys(): string[];
}

export class Transaction {
    constructor(idbTransaction: IDBTransaction);
    getStore(storeName: string): IDBObjectStore;
    log(type: string, data: object): void;
    commit(): Promise<void>;
    rollback(): void;
    getStats(): object;
}

export class TransactionManager {
    constructor(db: Database);
    begin(storeNames: string[], mode?: IDBTransactionMode): Promise<Transaction>;
    getActiveCount(): number;
}

// ========== Errors ==========

export class VFSError extends Error {
    code: string;
    constructor(message: string, code?: string);
}

export class VNodeNotFoundError extends VFSError {
    nodeId: string;
    constructor(nodeId: string);
}

export class PathExistsError extends VFSError {
    path: string;
    constructor(path: string);
}

export class NotDirectoryError extends VFSError {
    path: string;
    constructor(path: string);
}

export class DirectoryNotEmptyError extends VFSError {
    path: string;
    constructor(path: string);
}

export class ValidationError extends VFSError {
    errors: string[];
    constructor(message: string, errors?: string[]);
}

export class PermissionError extends VFSError {
    operation: string;
    path: string;
    constructor(operation: string, path: string);
}

export class ProviderError extends VFSError {
    providerName: string;
    constructor(providerName: string, message: string);
}

// ========== Additional Types ==========

export interface SystemStats {
    modules: Record<string, ModuleStats>;
    providers: string[];
    totalNodes: number;
    totalFiles: number;
    totalDirectories: number;
}

export interface ModuleStats {
    nodeCount: number;
    files: number;
    directories: number;
}

export const OBJECT_STORES: any[];
export const EVENTS: Record<string, string>;
