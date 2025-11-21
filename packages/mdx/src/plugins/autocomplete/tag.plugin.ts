
// mdx/plugins/autocomplete/tag.plugin.ts
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { AutocompletePlugin, AutocompleteProvider } from './autocomplete.plugin';
import type { Completion } from '@codemirror/autocomplete';

/**
 * 标签提供者
 */
export class TagAutocompleteSource implements AutocompleteProvider {
  private getTags: () => string[] | Promise<string[]>;

  constructor(options: { getTags: () => string[] | Promise<string[]> }) {
    this.getTags = options.getTags;
  }

  async getSuggestions(query: string): Promise<Completion[]> {
    const tags = await this.getTags();
    const filtered = tags.filter((tag) =>
      tag.toLowerCase().includes(query.toLowerCase())
    );

    return filtered.map((tag) => ({
      label: tag,
      type: 'keyword',
      detail: 'tag',
    }));
  }
}

/**
 * 标签插件选项
 */
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
