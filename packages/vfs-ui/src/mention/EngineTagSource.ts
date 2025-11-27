/**
 * @file vfs-ui/core/EngineTagSource.ts
 * @desc A generic tag autocomplete source that works with any ISessionEngine.
 */
import { IAutocompleteSource, type Suggestion, type ISessionEngine } from '@itookit/common';

// 定义带有 refCount 的 Tag 接口（扩展 common 中的基础定义）
interface TagDataWithRef {
    name: string;
    color?: string;
    refCount?: number;
}

export class EngineTagSource extends IAutocompleteSource {
    constructor(private engine: ISessionEngine) {
        super();
    }

    public async getSuggestions(query: string): Promise<Suggestion[]> {
        if (!this.engine.getAllTags) return [];
        try {
            // 获取所有标签
            const allTags = (await this.engine.getAllTags()) as TagDataWithRef[];
            
            const lowerQuery = query.toLowerCase();
            let filtered = query 
                ? allTags.filter(t => t.name.toLowerCase().includes(lowerQuery))
                : allTags;
            
            // [优化] 利用后端的引用计数进行排序：常用标签排在前面
            // 如果后端未返回 refCount (兼容旧适配器)，则保持原序或按名称排序
            filtered.sort((a, b) => {
                const countA = a.refCount || 0;
                const countB = b.refCount || 0;
                if (countA !== countB) {
                    return countB - countA; // 降序排列
                }
                return a.name.localeCompare(b.name); // 计数相同时按名称排序
            });

            return filtered.map(t => ({
                id: t.name,
                // [可选] 可以在 label 中展示计数，例如: "Work (5)"
                // 这里保持简洁，仅展示名称，依靠排序提供便利
                label: t.name, 
                type: 'tag',
                color: t.color,
                // 可以将 count 传递给 Suggestion 的 payload 或 extra 字段供 UI 高级渲染使用
                extra: { count: t.refCount }
            }));
        } catch (e) {
            console.error('Failed to fetch tags', e);
            return [];
        }
    }
}
