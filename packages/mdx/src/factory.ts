/**
 * @file mdx/factory.ts
 */
import { MDxEditor, MDxEditorConfig } from './editor/editor';
import { FoldablePlugin, FoldablePluginOptions } from './plugins/syntax-extensions/foldable.plugin';
import { MathJaxPlugin, MathJaxPluginOptions } from './plugins/syntax-extensions/mathjax.plugin';
import type { MDxPlugin } from './core/plugin';

// --- Plugin Registry ---

// 定义插件构造函数类型
type MDxPluginConstructor = new (...args: any[]) => MDxPlugin;

// 创建插件注册表
const pluginRegistry = new Map<string, MDxPluginConstructor>();

/**
 * 注册一个插件，以便通过字符串名称使用。
 * @param name - 插件的唯一名称 (例如, 'folder').
 * @param pluginClass - 插件的构造函数.
 */
export function registerPlugin(name: string, pluginClass: MDxPluginConstructor): void {
  if (pluginRegistry.has(name)) {
    console.warn(`Plugin with name "${name}" is already registered. Overwriting.`);
  }
  pluginRegistry.set(name, pluginClass);
}

// 注册内置插件
registerPlugin('folder', FoldablePlugin);
registerPlugin('mathjax', MathJaxPlugin);


// --- 新的配置接口 ---

/**
 * 定义在工厂函数中配置插件的灵活格式。
 */
export type PluginConfig = 
  | string                                      // 简单名称: 'folder'
  | MDxPlugin                                     // 预实例化插件: new FoldablePlugin()
  | [string, Record<string, any>]               // 名称和选项元组: ['folder', { defaultOpen: false }]
  | { name: string; options?: Record<string, any> }; // 名称和选项对象: { name: 'folder', options: { ... } }

/**
 * `createMDxEditor` 工厂函数的配置。
 * 扩展了基础编辑器配置，增加了插件管理功能。
 */
export interface MDxEditorFactoryConfig extends MDxEditorConfig {
  /**
   * 要加载的插件列表，格式灵活。
   * - `undefined` (默认): 加载默认插件 ('folder', 'mathjax').
   * - `[]`: 不加载任何插件。
   * - `['folder', ['mathjax', { cdnUrl: '...' }]]`: 加载指定插件和配置。
   */
  plugins?: PluginConfig[];

  /**
   * 为通过名称加载的插件提供默认选项。
   * 这些选项可以被 `plugins` 数组中的内联选项覆盖。
   */
  defaultPluginOptions?: {
    folder?: FoldablePluginOptions;
    mathjax?: MathJaxPluginOptions;
    [key: string]: Record<string, any> | undefined;
  };
}


// --- 工厂函数 ---

const DEFAULT_PLUGINS: PluginConfig[] = ['folder', 'mathjax'];

/**
 * 创建、配置并返回一个新的 MDxEditor 实例。
 * 这是推荐的、用户友好的初始化编辑器的方式。
 * @param config - 编辑器及其插件的配置对象。
 * @returns 一个完全配置好的 MDxEditor 实例，准备好调用 `init()`。
 */
export function createMDxEditor(config: MDxEditorFactoryConfig = {}): MDxEditor {
  // 1. 创建基础 MDxEditor 实例，传递核心配置属性。
  const editor = new MDxEditor({
    initialMode: config.initialMode,
    searchMarkClass: config.searchMarkClass,
    vfsCore: config.vfsCore,
    nodeId: config.nodeId,
    persistenceAdapter: config.persistenceAdapter,
    // 传递任何其他自定义属性
    ...config,
  });

  // 2. 决定加载哪些插件。如果未指定，则使用默认列表。
  const pluginsToLoad = config.plugins === undefined ? DEFAULT_PLUGINS : config.plugins;

  // 3. 遍历插件配置并将其添加到编辑器中。
  for (const pluginConfig of pluginsToLoad) {
    let pluginInstance: MDxPlugin | null = null;
    let pluginName: string | null = null;

    try {
      if (typeof pluginConfig === 'string') {
        // 情况: 'folder'
        pluginName = pluginConfig;
        const PluginClass = pluginRegistry.get(pluginName);
        if (PluginClass) {
          const options = config.defaultPluginOptions?.[pluginName] || {};
          pluginInstance = new PluginClass(options);
        }
      } else if (Array.isArray(pluginConfig)) {
        // 情况: ['folder', { defaultOpen: false }]
        const [name, inlineOptions] = pluginConfig;
        pluginName = name;
        const PluginClass = pluginRegistry.get(pluginName);
        if (PluginClass) {
          const defaultOptions = config.defaultPluginOptions?.[pluginName] || {};
          const finalOptions = { ...defaultOptions, ...inlineOptions };
          pluginInstance = new PluginClass(finalOptions);
        }
      } else if (typeof pluginConfig === 'object' && 'name' in pluginConfig && !('install' in pluginConfig)) {
        // 情况: { name: 'folder', options: { ... } }
        const { name, options: inlineOptions = {} } = pluginConfig as { name: string; options?: Record<string, any> };
        pluginName = name;
        const PluginClass = pluginRegistry.get(pluginName);
        if (PluginClass) {
            const defaultOptions = config.defaultPluginOptions?.[pluginName] || {};
            const finalOptions = { ...defaultOptions, ...inlineOptions };
            pluginInstance = new PluginClass(finalOptions);
        }
      } else if (typeof pluginConfig === 'object' && 'install' in pluginConfig) {
        // 情况: new FoldablePlugin() - 已经是实例
        pluginInstance = pluginConfig as MDxPlugin;
        pluginName = pluginInstance.name;
      }

      if (pluginInstance) {
        editor.use(pluginInstance);
      } else if (pluginName) {
        console.warn(`Plugin with name "${pluginName}" not found in registry and could not be loaded.`);
      } else {
        console.warn('Invalid plugin configuration encountered:', pluginConfig);
      }
    } catch (error) {
      console.error(`Failed to instantiate plugin "${pluginName || 'unknown'}" with config:`, pluginConfig, error);
    }
  }

  return editor;
}
