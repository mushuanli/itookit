// mdx/plugins/autocomplete/autocomplete.plugin.ts
import {type HoverPreviewData} from '@itookit/common';
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import type { Extension } from '@codemirror/state';
import {
  CompletionContext,
  CompletionResult,
  Completion,
} from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';

/**
 * 自动完成数据提供者接口
 */
export interface AutocompleteProvider {
  /**
   * 获取建议列表
   * @param query - 搜索词
   * @returns 建议项数组或 Promise
   */
  getSuggestions(query: string): Completion[] | Promise<Completion[]>;

  /**
   * 获取悬浮预览内容（可选）
   * @returns 预览数据，如果无法提供预览则返回 null
   */
  getHoverPreview?(item: Completion): Promise<HoverPreviewData | null>;
}

/**
 * 自动完成源配置
 */
export interface AutocompleteSourceConfig {
  /**
   * 触发字符（如 '@', '#', '/'）
   */
  triggerChar: string;

  /**
   * 数据提供者
   */
  provider: AutocompleteProvider;

  /**
   * 应用模板函数：将选中项转换为要插入的文本
   * @param item - 选中的补全项
   * @returns 要插入的文本
   */
  applyTemplate: (item: Completion) => string;

  /**
   * 最小查询长度（默认为 0）
   */
  minQueryLength?: number;
}

/**
 * 自动完成插件选项
 */
export interface AutocompletePluginOptions {
  /**
   * 自动完成源配置列表
   */
  sources: AutocompleteSourceConfig[];
}

/**
 * 通用自动完成插件
 * 支持多种触发字符和数据源
 */
export class AutocompletePlugin implements MDxPlugin {
  name = 'autocomplete:core';
  private options: AutocompletePluginOptions;

  constructor(options: AutocompletePluginOptions) {
    this.options = options;
  }

  install(context: PluginContext): void {
    const pluginManager = context.pluginManager;
    if (!pluginManager) {
      console.warn('AutocompletePlugin: PluginManager not available');
      return;
    }
    
    if (!(pluginManager as any)._autocompleteSources) {
      (pluginManager as any)._autocompleteSources = [];
    console.log('🔧 [AutocompletePlugin] Created _autocompleteSources array');
    }

  console.log(`🔧 [AutocompletePlugin] Adding ${this.options.sources.length} sources:`, 
    this.options.sources.map(s => s.triggerChar));
  
  (pluginManager as any)._autocompleteSources.push(...this.options.sources);
  
  console.log(`🔧 [AutocompletePlugin] Total sources now: ${(pluginManager as any)._autocompleteSources.length}`);
  }
}
