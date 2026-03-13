// @mdx/utils/regex-cache.ts
/**
 * 共享正则表达式缓存
 * 消除 MDxEditor 和 MDxRenderer 中重复的缓存实现
 */
export class RegexCache {
    private cache = new Map<string, RegExp>();

    constructor(private maxSize: number = 50) { }

    get(query: string, flags: string = 'gi'): RegExp {
        const key = `${query}:${flags}`;
        let regex = this.cache.get(key);

        if (!regex) {
            const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            regex = new RegExp(escaped, flags);

            // LRU 淘汰
            if (this.cache.size >= this.maxSize) {
                const firstKey = this.cache.keys().next().value;
                if (firstKey) this.cache.delete(firstKey);
            }
            this.cache.set(key, regex);
        }

        regex.lastIndex = 0;
        return regex;
    }

    clear(): void {
        this.cache.clear();
    }
}
