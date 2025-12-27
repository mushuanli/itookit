/**
 * @file common/utils/utils.ts
 */

export function slugify(text: string): string {
    if (typeof text !== 'string') return '';
    const slug = text.toString().toLowerCase().trim()
        .replace(/[\s_.,;!?'"()[\]{}]/g, '-')
        .replace(/[^\p{L}\p{N}-]+/gu, '')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || simpleHash(text);
}

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
        // 文档
        'pdf': 'application/pdf', 
        'txt': 'text/plain', 
        'md': 'text/markdown',
        'json': 'application/json',
        'xml': 'application/xml',
        'html': 'text/html',
        'css': 'text/css',
        'js': 'application/javascript',
        // Office
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls': 'application/vnd.ms-excel',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt': 'application/vnd.ms-powerpoint',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        // 音视频
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        // 压缩
        'zip': 'application/zip',
        'rar': 'application/x-rar-compressed',
        '7z': 'application/x-7z-compressed',
        };
        return map[ext || ''] || 'application/octet-stream';
    }