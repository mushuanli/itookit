/**
 * @file common/utils/utils.ts
 */

export function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

export function escapeHTML(str: string | null | undefined): string {
    if (!str) return '';
    const map: Record<string, string> = {
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#39;'
    };
    return str.replace(/[&<>"']/g, tag => map[tag] || tag);
}

export function generateUUID(): string {
    return 'node-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

/**
 * Generates a simplified, shorter UUID. Good enough for this context.
 * @returns {string} e.g., 'f4a2bcde'
 */
export function generateShortUUID(): string {
    return Math.random().toString(36).substring(2, 10);
}

export function generateId(prefix: string = 'item'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function debounce<T extends (...args: any[]) => any>(func: T, delay: number): ((...args: Parameters<T>) => void) & { cancel: () => void } {
    let timeout: ReturnType<typeof setTimeout>;
    // 必须使用 function 关键字才能动态绑定 this
    const debounced = function(this: any, ...args: Parameters<T>) {
        clearTimeout(timeout);
        // 捕获外部的 this
        const context = this; 
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
    debounced.cancel = () => clearTimeout(timeout);
    return debounced;
}

export function isClass(v: any): boolean {
    return typeof v === 'function' && /^\s*class\s+/.test(v.toString());
}

export function guessMimeType(filename: string): string {
        const ext = filename.split('.').pop()?.toLowerCase();
        const map: Record<string, string> = {
        // 图片
        'png': 'image/png', 
        'jpg': 'image/jpeg', 
        'jpeg': 'image/jpeg',
        'gif': 'image/gif', 
        'svg': 'image/svg+xml', 
        'webp': 'image/webp',
        'bmp': 'image/bmp',
        'ico': 'image/x-icon',

        // Office文档
        'pdf': 'application/pdf',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls': 'application/vnd.ms-excel',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt': 'application/vnd.ms-powerpoint',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

        'txt': 'text/plain',
        'md': 'text/markdown',
        
        // 代码
        'json': 'application/json',
        'js': 'text/javascript',
        'ts': 'text/typescript',
        'py': 'text/x-python',
        'html': 'text/html',
        'css': 'text/css',
        'xml': 'application/xml',
        'yaml': 'text/yaml',
        'yml': 'text/yaml',

        // 音视频
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'ogg': 'audio/ogg',
        
        // 视频
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        
        // 压缩
        'zip': 'application/zip',
        'gz': 'application/gzip',
        'tar': 'application/x-tar',
        'rar': 'application/x-rar-compressed',
        '7z': 'application/x-7z-compressed',
        };
        return map[ext || ''] || 'application/octet-stream';
    }



/**
 * 检查是否为图片类型
 */
export function isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
}

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


export async function calculateHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Blob 转 Base64
 */
export async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            // 移除 data URI 前缀
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * ArrayBuffer 转 Base64
 */

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
