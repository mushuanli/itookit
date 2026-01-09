
// mdx/plugins/autocomplete/tag.plugin.ts
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { AutocompletePlugin, AutocompleteProvider } from './autocomplete.plugin';
import type { Completion } from '@codemirror/autocomplete';

/**
 * 标签提供者
 */
export class TagAutocompleteSource implements AutocompleteProvider {
  private getTags: () => string[] | Promise<string[]>;
  
  // [优化] 缓存上次结果
  private cache: { query: string; results: Completion[] } | null = null;

  constructor(options: { getTags: () => string[] | Promise<string[]> }) {
    this.getTags = options.getTags;
  }

  async getSuggestions(query: string): Promise<Completion[]> {
    // 检查缓存
    if (this.cache && this.cache.query === query) {
      return this.cache.results;
    }
    
    const tags = await this.getTags();
    const lowerQuery = query.toLowerCase();
    
    const results = tags
      .filter((tag) => tag.toLowerCase().includes(lowerQuery))
      .map((tag) => ({
        label: tag,
        type: 'keyword',
        detail: 'tag',
      }));

    // 更新缓存
    this.cache = { query, results };
    
    return results;
  }
  
  // 清除缓存（当标签列表变化时调用）
  clearCache(): void {
    this.cache = null;
  }
}

export interface TagPluginOptions {
  /**
   * 获取标签列表的函数
   */
  getTags: () => string[] | Promise<string[]>;

  /**
   * 触发字符（默认为 '#'）
   */
  triggerChar?: string;
}

/**
 * 标签自动完成插件
 */
export class TagPlugin implements MDxPlugin {
  name = 'autocomplete:tag';
  private autocompletePlugin: AutocompletePlugin;

  constructor(options: TagPluginOptions) {
    const triggerChar = options.triggerChar || '#';
    const provider = new TagAutocompleteSource({ getTags: options.getTags });

    this.autocompletePlugin = new AutocompletePlugin({
      sources: [
        {
          triggerChar,
          provider,
          applyTemplate: (item) => `${triggerChar}${item.label} `,
        },
      ],
    });
  }

  install(context: PluginContext): void {
    this.autocompletePlugin.install(context);
  }
}
