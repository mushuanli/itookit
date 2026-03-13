/**
 * @file mdx/factory.ts
 */
import { IEditor, EditorOptions, EditorFactory } from '@itookit/common';
import { MDxEditor, MDxEditorConfig } from './editor/mdx-editor';
import { globalPluginRegistry } from './core/plugin-registry';
import type { MDxPlugin } from './core/types';

// === 默认插件注册（声明式） ===
import { CoreEditorPlugin } from './plugins/core/core-editor.plugin';
import { CoreTitleBarPlugin } from './plugins/ui/titlebar.plugin';
import { ToolbarPlugin } from './plugins/ui/toolbar.plugin';
import { FormattingPlugin } from './plugins/ui/formatting.plugin';
import { CalloutPlugin } from './plugins/syntax-extensions/callout.plugin';
import { MathJaxPlugin } from './plugins/syntax-extensions/mathjax.plugin';
import { FoldablePlugin } from './plugins/syntax-extensions/foldable.plugin';
import { MediaPlugin } from './plugins/syntax-extensions/media.plugin';
import { MermaidPlugin } from './plugins/syntax-extensions/mermaid.plugin';
import { SvgPlugin } from './plugins/syntax-extensions/svg.plugin';
import { VegaPlugin } from './plugins/syntax-extensions/vega.plugin';
import { PlantUMLPlugin } from './plugins/syntax-extensions/plantuml.plugin';
import { ClozePlugin } from './plugins/cloze/cloze.plugin';
import { ClozeControlsPlugin } from './plugins/cloze/cloze-control-ui.plugin';
import { MemoryPlugin } from './plugins/cloze/memory.plugin';
import { TablePlugin } from './plugins/interactions/table.plugin';
import { TaskListPlugin } from './plugins/interactions/task-list.plugin';
import { CodeBlockControlsPlugin } from './plugins/interactions/codeblock-controls.plugin';
import { ClipboardPlugin } from './plugins/interactions/clipboard.plugin';
import { UploadPlugin } from './plugins/interactions/upload.plugin';
import { SourceSyncPlugin } from './plugins/interactions/source-jump.plugin';
import { TagPlugin } from './plugins/autocomplete/tag.plugin';
import { MentionPlugin } from './plugins/autocomplete/mention.plugin';
import { AssetResolverPlugin } from './plugins/core/asset-resolver.plugin';
import { AssetManagerPlugin } from './plugins/ui/asset-manager.plugin';
import { AutoSavePlugin } from './plugins/interactions/auto-save.plugin';

// 批量注册
const PLUGIN_DEFINITIONS: Array<[string, new (...args: any[]) => MDxPlugin, { priority?: number; dependencies?: string[] }]> = [
  ['editor:core',              CoreEditorPlugin,      { priority: 1 }],
  ['core:titlebar',            CoreTitleBarPlugin,     { priority: 2 }],
  ['ui:toolbar',               ToolbarPlugin,          { priority: 2 }],
  ['ui:formatting',            FormattingPlugin,       { priority: 3, dependencies: ['ui:toolbar'] }],
  ['callout',                  CalloutPlugin,          { priority: 4 }],
  ['mathjax',                  MathJaxPlugin,          { priority: 5 }],
  ['folder',                   FoldablePlugin,         { priority: 6 }],
  ['media',                    MediaPlugin,            { priority: 7 }],
  ['mermaid',                  MermaidPlugin,          { priority: 8 }],
  ['svg',                      SvgPlugin,              { priority: 9 }],
  ['cloze:cloze',              ClozePlugin,            { priority: 10 }],
  ['cloze:cloze-controls',     ClozeControlsPlugin,    { priority: 20, dependencies: ['cloze:cloze'] }],
  ['cloze:memory',             MemoryPlugin,           { priority: 20, dependencies: ['cloze:cloze'] }],
  ['interaction:table',        TablePlugin,            { priority: 50 }],
  ['task-list',                TaskListPlugin,         { priority: 51 }],
  ['codeblock-controls',       CodeBlockControlsPlugin,{ priority: 52 }],
  ['autocomplete:tag',         TagPlugin,              { priority: 53 }],
  ['autocomplete:mention',     MentionPlugin,          { priority: 54 }],
  ['interaction:clipboard',    ClipboardPlugin,        { priority: 55 }],
  ['interaction:upload',       UploadPlugin,           { priority: 60 }],
  ['interaction:source-sync',  SourceSyncPlugin,       { priority: 60 }],
  ['plantuml',                 PlantUMLPlugin,         { priority: 70 }],
  ['vega',                     VegaPlugin,             { priority: 71 }],
  ['interaction:auto-save',    AutoSavePlugin,         { priority: 90 }],
  ['ui:asset-manager',         AssetManagerPlugin,     { priority: 90, dependencies: ['core:titlebar'] }],
  ['core:asset-resolver',      AssetResolverPlugin,    { priority: 95 }],
];

for (const [name, ctor, opts] of PLUGIN_DEFINITIONS) {
  globalPluginRegistry.register(name, ctor, opts);
}

// === 类型 ===

export type PluginConfig =
  | string
  | MDxPlugin
  | [string, Record<string, any>]
  | { name: string; options?: Record<string, any> };

export interface MDxEditorFactoryConfig extends EditorOptions {
  plugins?: PluginConfig[];
  onSave?: (content: string) => Promise<void>;
  defaultPluginOptions?: Record<string, Record<string, any> | undefined>;
}

// === 默认插件列表 ===

const DEFAULT_PLUGINS: string[] = [
  'core:asset-resolver',
  'interaction:auto-save',
  'interaction:clipboard',
  'interaction:upload',
  'ui:toolbar',
  'ui:formatting',
  'interaction:source-sync',
  'interaction:table',
  'folder',
  'mathjax',
  'media',
  'callout',
  'mermaid',
  'svg',
  'codeblock-controls',
  'task-list',
];

// === 工具函数 ===

function getPluginName(config: PluginConfig): string {
  if (typeof config === 'string') return config;
  if (Array.isArray(config)) return config[0];
  if (typeof config === 'object' && 'name' in config && !('install' in config)) {
    return (config as { name: string }).name;
  }
  if (typeof config === 'object' && 'install' in config) {
    return (config as MDxPlugin).name;
  }
  return '';
}

function resolvePluginInstance(
  pluginName: string,
  pluginConfig: PluginConfig,
  defaultOptions: Record<string, Record<string, any> | undefined>
): MDxPlugin | null {
  // 已实例化的插件直接返回
  if (typeof pluginConfig === 'object' && 'install' in pluginConfig) {
    return pluginConfig as MDxPlugin;
  }

  const info = globalPluginRegistry.get(pluginName);
  if (!info) {
    console.warn(`Plugin "${pluginName}" not found in registry.`);
    return null;
  }

  // 合并选项：defaultPluginOptions < inline options
  let options: Record<string, any> = {};

  if (typeof pluginConfig === 'string') {
    options = defaultOptions[pluginName] || {};
  } else if (Array.isArray(pluginConfig)) {
    options = { ...(defaultOptions[pluginName] || {}), ...pluginConfig[1] };
  } else if (typeof pluginConfig === 'object' && 'name' in pluginConfig) {
    const { options: inline = {} } = pluginConfig as { name: string; options?: Record<string, any> };
    options = { ...(defaultOptions[pluginName] || {}), ...inline };
  }

  return new info.constructor(options);
}

// === 配置桥接 ===

function bridgeSaveCallback(config: MDxEditorFactoryConfig): ((content: string) => Promise<void>) | undefined {
  if (config.onSave) return config.onSave;

  if (config.hostContext && config.nodeId) {
    return async (content: string) => {
      await config.hostContext!.saveContent(config.nodeId!, content);
    };
  }

  return undefined;
}

function bridgeTitleBarOptions(config: MDxEditorFactoryConfig): void {
  if (!config.hostContext) return;

  config.defaultPluginOptions = config.defaultPluginOptions || {};
  const existing = config.defaultPluginOptions['core:titlebar'] || {};

  config.defaultPluginOptions['core:titlebar'] = {
    ...existing,
    onSidebarToggle: existing.onSidebarToggle || (() => config.hostContext?.toggleSidebar()),
    saveCallback: async (editor: any) => { await editor.save(); },
  };
}

// === 主工厂函数 ===

export async function createMDxEditor(
  container: HTMLElement,
  config: MDxEditorFactoryConfig = {}
): Promise<IEditor> {
  const userPlugins = config.plugins || [];
  const defaultOpts = config.defaultPluginOptions || {};

  // 1. 自动加载 Asset Manager
  autoLoadAssetManager(userPlugins, defaultOpts);

  // 2. 桥接保存回调
  config.onSave = bridgeSaveCallback(config);
  bridgeTitleBarOptions(config);

  // 3. 创建编辑器
  const editor = new MDxEditor(config as MDxEditorConfig);

  // 4. 核心插件（强制加载）
  editor.use(new CoreEditorPlugin(defaultOpts['editor:core'] || {}));

  // 5. 构建最终插件列表
  const pluginMap = buildPluginMap(userPlugins, DEFAULT_PLUGINS);

  // 6. 拓扑排序
  const sortedNames = globalPluginRegistry.sortByDependencies(Array.from(pluginMap.keys()));

  // 7. 实例化并注册
  for (const name of sortedNames) {
    const pluginConfig = pluginMap.get(name)!;
    try {
      const instance = resolvePluginInstance(name, pluginConfig, defaultOpts);
      if (instance) editor.use(instance);
    } catch (error) {
      console.error(`Failed to load plugin "${name}":`, error);
    }
  }

  // 8. 异步初始化
  await editor.init(container, config.initialContent || '');

  return editor;
}

// === 辅助函数 ===

function autoLoadAssetManager(
  userPlugins: PluginConfig[],
  defaultOpts: Record<string, Record<string, any> | undefined>
): void {
  const titleBarOpts = defaultOpts['core:titlebar'] || {};
  const isTitleBarEnabled = userPlugins.some(p => getPluginName(p) === 'core:titlebar') ||
    DEFAULT_PLUGINS.includes('core:titlebar');

  if (isTitleBarEnabled && titleBarOpts.enableAssetManager !== false) {
    if (!userPlugins.some(p => getPluginName(p) === 'ui:asset-manager')) {
      userPlugins.push('ui:asset-manager');
    }
  }
}

function buildPluginMap(
  userPlugins: PluginConfig[],
  basePlugins: string[]
): Map<string, PluginConfig> {
  const pluginMap = new Map<string, PluginConfig>();
  const exclusions = new Set<string>();

  // 检查是否禁用所有默认插件
  let base = basePlugins;
  if (userPlugins.length > 0 && getPluginName(userPlugins[0]) === '-all') {
    base = [];
    userPlugins.shift();
  }

  // 基础插件
  for (const name of base) {
    pluginMap.set(name, name);
  }

  // 用户插件（覆盖 + 排除）
  for (const config of userPlugins) {
    const name = getPluginName(config);
    if (!name) {
      console.warn('Invalid plugin config:', config);
      continue;
    }

    if (name.startsWith('-')) {
      exclusions.add(name.substring(1));
    } else {
      pluginMap.set(name, config);

      // Cloze 自动关联
      if (name === 'cloze:cloze') {
        if (!pluginMap.has('cloze:cloze-controls')) pluginMap.set('cloze:cloze-controls', 'cloze:cloze-controls');
        if (!pluginMap.has('cloze:memory')) pluginMap.set('cloze:memory', 'cloze:memory');
      }
    }
  }

  // 应用排除
  for (const excluded of exclusions) {
    pluginMap.delete(excluded);
  }

  return pluginMap;
}

// === 导出工厂注册函数 ===

export const registerPlugin = globalPluginRegistry.register.bind(globalPluginRegistry);

// === 默认工厂 ===

export const defaultEditorFactory: EditorFactory = async (container, options) => {
  return createMDxEditor(container, {
    ...options,
    plugins: ['core:titlebar', 'interaction:auto-save', ...(options.plugins || [])],
    initialMode: 'render',
    defaultPluginOptions: {
      ...options.defaultPluginOptions,
      'core:titlebar': {
        title: options.title || 'Untitled',
        enableToggleEditMode: true,
        ...(options.defaultPluginOptions?.['core:titlebar'] || {}),
      },
    },
  });
};
