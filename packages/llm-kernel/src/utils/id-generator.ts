// @file: llm-kernel/src/utils/id-generator.ts

/**
 * ID 生成器配置
 */
export interface IdGeneratorOptions {
    /** 前缀 */
    prefix?: string;
    
    /** 是否包含时间戳 */
    includeTimestamp?: boolean;
    
    /** 随机部分长度 */
    randomLength?: number;
    
    /** 分隔符 */
    separator?: string;
}

/**
 * 生成唯一 ID
 */
export function generateId(options: IdGeneratorOptions = {}): string {
    const {
        prefix = '',
        includeTimestamp = true,
        randomLength = 8,
        separator = '-'
    } = options;
    
    const parts: string[] = [];
    
    // 添加前缀
    if (prefix) {
        parts.push(prefix);
    }
    
    // 添加时间戳
    if (includeTimestamp) {
        parts.push(Date.now().toString(36));
    }
    
    // 添加随机部分
    parts.push(generateRandomString(randomLength));
    
    return parts.join(separator);
}

/**
 * 生成随机字符串
 */
export function generateRandomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    // 使用 crypto API（如果可用）
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        for (let i = 0; i < length; i++) {
            result += chars[array[i] % chars.length];
        }
    } else {
        // 回退到 Math.random
        for (let i = 0; i < length; i++) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }
    }
    
    return result;
}

/**
 * 生成 UUID v4
 */
export function generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    
    // 回退实现
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * 生成执行 ID
 */
export function generateExecutionId(): string {
    return generateId({ prefix: 'exec', randomLength: 9 });
}

/**
 * 生成节点 ID
 */
export function generateNodeId(): string {
    return generateId({ prefix: 'node', randomLength: 8 });
}

/**
 * 生成任务 ID
 */
export function generateTaskId(): string {
    return generateId({ prefix: 'task', randomLength: 9 });
}

/**
 * 生成会话 ID
 */
export function generateSessionId(): string {
    return generateUUID();
}

/**
 * ID 验证
 */
export function isValidId(id: string, options?: { prefix?: string }): boolean {
    if (!id || typeof id !== 'string') {
        return false;
    }
    
    if (options?.prefix && !id.startsWith(options.prefix)) {
        return false;
    }
    
    // 基本格式验证
    return /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * 从 ID 提取时间戳
 */
export function extractTimestamp(id: string): number | null {
    const parts = id.split('-');
    
    // 跳过前缀（如果有）
    const timestampPart = parts.length > 1 ? parts[1] : parts[0];
    
    try {
        const timestamp = parseInt(timestampPart, 36);
        if (!isNaN(timestamp) && timestamp > 0) {
            return timestamp;
        }
    } catch {
        // 忽略解析错误
    }
    
    return null;
}

/**
 * 短 ID 生成器（用于显示）
 */
export function generateShortId(length: number = 6): string {
    return generateRandomString(length);
}

/**
 * 基于内容的哈希 ID
 */
export function generateContentHash(content: string): string {
    let hash = 0;
    
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 转换为 32 位整数
    }
    
    // 转换为正数并编码
    const positiveHash = Math.abs(hash);
    return positiveHash.toString(36);
}

/**
 * 序列 ID 生成器
 */
export class SequenceIdGenerator {
    private counter = 0;
    private prefix: string;
    
    constructor(prefix: string = 'seq') {
        this.prefix = prefix;
    }
    
    next(): string {
        return `${this.prefix}-${++this.counter}`;
    }
    
    current(): number {
        return this.counter;
    }
    
    reset(): void {
        this.counter = 0;
    }
}
