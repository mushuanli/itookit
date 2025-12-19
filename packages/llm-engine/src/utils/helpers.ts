// @file: llm-engine/src/utils/helpers.ts

// ============================================
// 从 common 重新导出的工具函数
// ============================================

export { 
    generateUUID, 
    generateShortUUID as generateShortId,
    debounce,
    escapeHTML 
} from '@itookit/common';

// ============================================
// LLM Engine 特有的工具函数
// ============================================

/**
 * 延迟执行
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 节流
 */
export function throttle<T extends (...args: any[]) => any>(
    fn: T,
    limit: number
): (...args: Parameters<T>) => void {
    let inThrottle = false;
    
    return (...args: Parameters<T>) => {
        if (!inThrottle) {
            fn(...args);
            inThrottle = true;
            setTimeout(() => {
                inThrottle = false;
            }, limit);
        }
    };
}

/**
 * 重试
 */
export async function retry<T>(
    fn: () => Promise<T>,
    options: {
        maxAttempts?: number;
        delay?: number;
        backoff?: boolean;
        shouldRetry?: (error: any) => boolean;
    } = {}
): Promise<T> {
    const {
        maxAttempts = 3,
        delay = 1000,
        backoff = true,
        shouldRetry = () => true
    } = options;
    
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            if (attempt === maxAttempts || !shouldRetry(error)) {
                throw error;
            }
            
            const waitTime = backoff ? delay * Math.pow(2, attempt - 1) : delay;
            await sleep(waitTime);
        }
    }
    
    throw lastError;
}

/**
 * 超时包装
 */
export function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string = 'Operation timed out'
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(message));
        }, timeoutMs);
        
        promise
            .then(result => {
                clearTimeout(timeoutId);
                resolve(result);
            })
            .catch(error => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
}

/**
 * 安全 JSON 解析
 */
export function safeJsonParse<T>(str: string, fallback: T): T {
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

/**
 * 深度克隆
 */
export function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    
    if (obj instanceof Date) {
        return new Date(obj.getTime()) as any;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item)) as any;
    }
    
    const cloned: any = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            cloned[key] = deepClone((obj as any)[key]);
        }
    }
    
    return cloned;
}

/**
 * 截断字符串
 */
export function truncate(str: string, maxLength: number, suffix: string = '...'): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let size = bytes;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * 格式化持续时间
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * 相对时间
 */
export function timeAgo(date: Date | number): string {
    const seconds = Math.floor((Date.now() - (typeof date === 'number' ? date : date.getTime())) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    
    const d = typeof date === 'number' ? new Date(date) : date;
    return d.toLocaleDateString();
}
