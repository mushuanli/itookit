// @file: llm-kernel/src/runtime/memory-store.ts

/**
 * 内存条目
 */
export interface MemoryEntry<T = any> {
    key: string;
    value: T;
    createdAt: number;
    updatedAt: number;
    expiresAt?: number;
    tags?: string[];
    metadata?: Record<string, any>;
}

/**
 * 查询选项
 */
export interface QueryOptions {
    /** 按标签过滤 */
    tags?: string[];
    
    /** 按前缀过滤 */
    prefix?: string;
    
    /** 限制数量 */
    limit?: number;
    
    /** 是否包含过期项 */
    includeExpired?: boolean;
}

/**
 * 内存存储
 * 用于执行过程中的临时数据存储
 */
export class MemoryStore {
    private store = new Map<string, MemoryEntry>();
    private tagIndex = new Map<string, Set<string>>();
    
    /**
     * 设置值
     */
    set<T>(
        key: string, 
        value: T, 
        options?: {
            ttl?: number;
            tags?: string[];
            metadata?: Record<string, any>;
        }
    ): void {
        const now = Date.now();
        
        // 移除旧的标签索引
        const existing = this.store.get(key);
        if (existing?.tags) {
            for (const tag of existing.tags) {
                this.tagIndex.get(tag)?.delete(key);
            }
        }
        
        // 创建新条目
        const entry: MemoryEntry<T> = {
            key,
            value,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            expiresAt: options?.ttl ? now + options.ttl : undefined,
            tags: options?.tags,
            metadata: options?.metadata
        };
        
        this.store.set(key, entry);
        
        // 更新标签索引
        if (options?.tags) {
            for (const tag of options.tags) {
                if (!this.tagIndex.has(tag)) {
                    this.tagIndex.set(tag, new Set());
                }
                this.tagIndex.get(tag)!.add(key);
            }
        }
    }
    
    /**
     * 获取值
     */
    get<T>(key: string): T | undefined {
        const entry = this.store.get(key);
        
        if (!entry) return undefined;
        
        // 检查过期
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
            this.delete(key);
            return undefined;
        }
        
        return entry.value as T;
    }
    
    /**
     * 获取完整条目
     */
    getEntry<T>(key: string): MemoryEntry<T> | undefined {
        const entry = this.store.get(key);
        
        if (!entry) return undefined;
        
        // 检查过期
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
            this.delete(key);
            return undefined;
        }
        
        return entry as MemoryEntry<T>;
    }
    
    /**
     * 检查是否存在
     */
    has(key: string): boolean {
        const entry = this.store.get(key);
        
        if (!entry) return false;
        
        // 检查过期
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
            this.delete(key);
            return false;
        }
        
        return true;
    }
    
    /**
     * 删除值
     */
    delete(key: string): boolean {
        const entry = this.store.get(key);
        
        if (!entry) return false;
        
        // 移除标签索引
        if (entry.tags) {
            for (const tag of entry.tags) {
                this.tagIndex.get(tag)?.delete(key);
            }
        }
        
        return this.store.delete(key);
    }
    
    /**
     * 查询条目
     */
    query<T>(options: QueryOptions = {}): MemoryEntry<T>[] {
        const results: MemoryEntry<T>[] = [];
        const now = Date.now();
        
        // 按标签过滤
        let keys: Set<string>;
        if (options.tags && options.tags.length > 0) {
            // 取标签的交集
            keys = new Set(this.tagIndex.get(options.tags[0]) || []);
            for (let i = 1; i < options.tags.length; i++) {
                const tagKeys = this.tagIndex.get(options.tags[i]) || new Set();
                keys = new Set([...keys].filter(k => tagKeys.has(k)));
            }
        } else {
            keys = new Set(this.store.keys());
        }
        
        for (const key of keys) {
            // 前缀过滤
            if (options.prefix && !key.startsWith(options.prefix)) {
                continue;
            }
            
            const entry = this.store.get(key);
            if (!entry) continue;
            
            // 过期过滤
            if (!options.includeExpired && entry.expiresAt && entry.expiresAt < now) {
                continue;
            }
            
            results.push(entry as MemoryEntry<T>);
            
            // 数量限制
            if (options.limit && results.length >= options.limit) {
                break;
            }
        }
        
        return results;
    }
    
    /**
     * 按标签获取所有值
     */
    getByTag<T>(tag: string): T[] {
        const keys = this.tagIndex.get(tag);
        if (!keys) return [];
        
        const values: T[] = [];
        for (const key of keys) {
            const value = this.get<T>(key);
            if (value !== undefined) {
                values.push(value);
            }
        }
        
        return values;
    }
    
    /**
     * 清除所有过期项
     */
    cleanup(): number {
        const now = Date.now();
        let count = 0;
        
        for (const [key, entry] of this.store) {
            if (entry.expiresAt && entry.expiresAt < now) {
                this.delete(key);
                count++;
            }
        }
        
        return count;
    }
    
    /**
     * 清空存储
     */
    clear(): void {
        this.store.clear();
        this.tagIndex.clear();
    }
    
    /**
     * 获取存储大小
     */
    size(): number {
        return this.store.size;
    }
    
    /**
     * 获取所有键
     */
    keys(): string[] {
        return Array.from(this.store.keys());
    }
    
    /**
     * 导出为对象
     */
    toObject(): Record<string, any> {
        const result: Record<string, any> = {};
        
        for (const [key, entry] of this.store) {
            // 跳过过期项
            if (entry.expiresAt && entry.expiresAt < Date.now()) {
                continue;
            }
            result[key] = entry.value;
        }
        
        return result;
    }
    
    /**
     * 从对象导入
     */
    fromObject(data: Record<string, any>): void {
        for (const [key, value] of Object.entries(data)) {
            this.set(key, value);
        }
    }
}

/**
 * 创建内存存储的便捷函数
 */
export function createMemoryStore(): MemoryStore {
    return new MemoryStore();
}

/**
 * 全局内存存储实例
 */
let globalStore: MemoryStore | null = null;

export function getGlobalMemoryStore(): MemoryStore {
    if (!globalStore) {
        globalStore = new MemoryStore();
    }
    return globalStore;
}

/**
 * 重置全局存储（用于测试）
 */
export function resetGlobalMemoryStore(): void {
    globalStore?.clear();
    globalStore = null;
}

/**
 * 作用域内存存储
 * 支持层级隔离，子作用域可以访问父作用域的数据
 */
export class ScopedMemoryStore {
    private local: MemoryStore;
    private parent?: ScopedMemoryStore;
    
    constructor(parent?: ScopedMemoryStore) {
        this.local = new MemoryStore();
        this.parent = parent;
    }
    
    /**
     * 设置值（仅在本地作用域）
     */
    set<T>(
        key: string, 
        value: T, 
        options?: {
            ttl?: number;
            tags?: string[];
            metadata?: Record<string, any>;
        }
    ): void {
        this.local.set(key, value, options);
    }
    
    /**
     * 获取值（先查本地，再查父级）
     */
    get<T>(key: string): T | undefined {
        const localValue = this.local.get<T>(key);
        if (localValue !== undefined) {
            return localValue;
        }
        
        return this.parent?.get<T>(key);
    }
    
    /**
     * 检查是否存在（包括父级）
     */
    has(key: string): boolean {
        return this.local.has(key) || (this.parent?.has(key) ?? false);
    }
    
    /**
     * 仅检查本地是否存在
     */
    hasLocal(key: string): boolean {
        return this.local.has(key);
    }
    
    /**
     * 删除值（仅本地）
     */
    delete(key: string): boolean {
        return this.local.delete(key);
    }
    
    /**
     * 创建子作用域
     */
    createChild(): ScopedMemoryStore {
        return new ScopedMemoryStore(this);
    }
    
    /**
     * 获取父作用域
     */
    getParent(): ScopedMemoryStore | undefined {
        return this.parent;
    }
    
    /**
     * 清空本地存储
     */
    clearLocal(): void {
        this.local.clear();
    }
    
    /**
     * 获取本地存储大小
     */
    localSize(): number {
        return this.local.size();
    }
    
    /**
     * 合并所有层级为对象
     */
    toObject(): Record<string, any> {
        const parentData = this.parent?.toObject() || {};
        const localData = this.local.toObject();
        return { ...parentData, ...localData };
    }
}
