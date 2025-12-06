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


// ✨ [修复 4.1] 安全的字符串转换
export function safeStringify(input: unknown): string {
    if (typeof input === 'string') {
        return input;
    }
    if (input === null || input === undefined) {
        return '';
    }
    if (typeof input === 'object') {
        try {
            return JSON.stringify(input);
        } catch {
            return String(input);
        }
    }
    return String(input);
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
