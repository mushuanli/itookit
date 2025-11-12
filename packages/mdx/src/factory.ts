/**
 * @file mdx/factory.ts
 */
import { MDxEditor, MDxEditorConfig } from './editor/editor';
import { FoldablePlugin, FoldablePluginOptions } from './plugins/syntax-extensions/foldable.plugin';
import { MathJaxPlugin, MathJaxPluginOptions } from './plugins/syntax-extensions/mathjax.plugin';

import { MediaPlugin, MediaPluginOptions } from './plugins/syntax-extensions/media.plugin';
import { MermaidPlugin, MermaidPluginOptions } from './plugins/syntax-extensions/mermaid.plugin';

import { ClozePlugin } from './plugins/cloze/cloze.plugin';
import { ClozeControlsPlugin } from './plugins/cloze/cloze-control-ui.plugin';
import { MemoryPlugin } from './plugins/cloze/memory.plugin';

import type { MDxPlugin } from './core/plugin';

// --- Plugin Registry ---

// 定义插件构造函数类型
type MDxPluginConstructor = new (...args: any[]) => MDxPlugin;

/**
 * 插件注册时存储的元数据信息。
 */
export interface PluginRegistrationInfo {
  constructor: MDxPluginConstructor;
  priority: number;
  dependencies: string[];
}

/**
 * 插件注册时的选项。
 */
export interface RegisterPluginOptions {
  /**
   * 加载优先级。数字越小，优先级越高，越先加载。
   * @default 100
   */
  priority?: number;
  /**
   * 依赖的插件名称列表。
   * 依赖项会确保在本插件之前加载。
   * @default []
   */
  dependencies?: string[];
}

// --- 更新插件注册表 ---

const pluginRegistry = new Map<string, PluginRegistrationInfo>();

/**
 * 注册一个插件，并声明其元数据（优先级和依赖）。
 * @param name - 插件的唯一名称。
 * @param pluginClass - 插件的构造函数。
 * @param options - 插件的元数据选项。
 */
export function registerPlugin(
  name: string,
  pluginClass: MDxPluginConstructor,
  options: RegisterPluginOptions = {}
): void {
  if (pluginRegistry.has(name)) {
    console.warn(`Plugin with name "${name}" is already registered. Overwriting.`);
  }
  
  pluginRegistry.set(name, {
    constructor: pluginClass,
    priority: options.priority ?? 100, // 默认优先级较低
    dependencies: options.dependencies ?? [],
  });
}

// --- 为插件注册添加元数据 ---

// 核心功能插件，优先级最高
registerPlugin('mathjax', MathJaxPlugin, { priority: 5 });
registerPlugin('folder', FoldablePlugin, { priority: 6 });
registerPlugin('media', MediaPlugin, { priority: 7 });
registerPlugin('mermaid', MermaidPlugin, { priority: 8 });

registerPlugin('cloze', ClozePlugin, { priority: 10 });

// 依赖于核心功能的插件，优先级较低
registerPlugin('cloze-controls', ClozeControlsPlugin, {
  priority: 20,
  dependencies: ['cloze'],
});
registerPlugin('memory', MemoryPlugin, {
  priority: 20,
  dependencies: ['cloze'],
});


// --- 新的配置接口 ---

export type PluginConfig = 
  | string
  | MDxPlugin
  | [string, Record<string, any>]
  | { name: string; options?: Record<string, any> };

export interface MDxEditorFactoryConfig extends MDxEditorConfig {
  plugins?: PluginConfig[];
  defaultPluginOptions?: {
    folder?: FoldablePluginOptions;
    mathjax?: MathJaxPluginOptions;
    media?: MediaPluginOptions;
    mermaid?: MermaidPluginOptions;
    [key: string]: Record<string, any> | undefined;
  };
}


// --- 工厂函数 ---

const DEFAULT_PLUGINS: PluginConfig[] = ['folder', 'mathjax','media','mermaid'];
const ALL_PLUGINS_DISABLED_FLAG = '-all';

/**
 * 从不同格式的插件配置中提取名称。
 * @internal
 */
function getPluginName(config: PluginConfig): string {
    if (typeof config === 'string') return config;
    if (Array.isArray(config)) return config[0];
    if (typeof config === 'object' && 'name' in config && !('install' in config)) return (config as { name: string }).name;
    if (typeof config === 'object' && 'install' in config) return (config as MDxPlugin).name;
    return '';
}

/**
 * 根据依赖和优先级对插件列表进行排序。
 * 使用基于 Kahn 算法的拓扑排序，并结合优先级队列。
 * @param pluginNames - 待排序的插件名称列表。
 * @returns 排序后的插件名称列表。
 * @throws 如果检测到循环依赖。
 */
function sortPlugins(pluginNames: string[]): string[] {
  const sorted: string[] = [];
  const inDegrees = new Map<string, number>();
  const graph = new Map<string, string[]>(); // key: dependency, value: list of plugins that depend on it

  // 1. 初始化图和入度
  for (const name of pluginNames) {
    inDegrees.set(name, 0);
    graph.set(name, []);
  }

  // 2. 构建图和计算入度
  for (const name of pluginNames) {
    const info = pluginRegistry.get(name);
    if (!info) continue;

    for (const dep of info.dependencies) {
      if (pluginNames.includes(dep)) { // 只考虑当前加载列表中的依赖
        graph.get(dep)!.push(name);
        inDegrees.set(name, (inDegrees.get(name) || 0) + 1);
      } else {
        console.warn(`Plugin "${name}" has a dependency "${dep}" which is not in the current loading list. This dependency will be ignored.`);
      }
    }
  }

  // 3. 初始化优先级队列（存储所有入度为0的插件）
  const queue: string[] = [];
  for (const name of pluginNames) {
    if (inDegrees.get(name) === 0) {
      queue.push(name);
    }
  }

  const getPriority = (name: string) => pluginRegistry.get(name)?.priority ?? 100;
  
  // 4. 拓扑排序主循环
  while (queue.length > 0) {
    // 按优先级排序队列，数字小的在前
    queue.sort((a, b) => getPriority(a) - getPriority(b));

    const current = queue.shift()!;
    sorted.push(current);

    for (const neighbor of graph.get(current) || []) {
      const newDegree = (inDegrees.get(neighbor) || 1) - 1;
      inDegrees.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // 5. 检测循环依赖
  if (sorted.length !== pluginNames.length) {
    const remaining = pluginNames.filter(p => !sorted.includes(p));
    throw new Error(`Circular dependency detected among plugins: ${remaining.join(', ')}`);
  }

  return sorted;
}


/**
 * 创建、配置并返回一个新的 MDxEditor 实例。
 * @param config - 编辑器及其插件的配置对象。
 * @returns 一个完全配置好的 MDxEditor 实例，准备好调用 `init()`。
 */
export function createMDxEditor(config: MDxEditorFactoryConfig = {}): MDxEditor {
  const editor = new MDxEditor({
    initialMode: config.initialMode,
    searchMarkClass: config.searchMarkClass,
    vfsCore: config.vfsCore,
    nodeId: config.nodeId,
    persistenceAdapter: config.persistenceAdapter,
    ...config,
  });

  let basePlugins = DEFAULT_PLUGINS;
  const userPlugins = config.plugins || [];

  if (userPlugins.length > 0 && getPluginName(userPlugins[0]) === ALL_PLUGINS_DISABLED_FLAG) {
    basePlugins = [];
    userPlugins.shift();
  }
  
  const combinedPlugins = [...basePlugins, ...userPlugins];
  const pluginMap = new Map<string, PluginConfig>();
  const exclusions = new Set<string>();

  for (const pluginConfig of combinedPlugins) {
    const name = getPluginName(pluginConfig);
    if (!name) {
      console.warn('Invalid plugin configuration encountered:', pluginConfig);
      continue;
    }

    if (name.startsWith('-')) {
      exclusions.add(name.substring(1));
      continue;
    }
    
    pluginMap.set(name, pluginConfig);

    if (name === 'cloze') {
      if (!pluginMap.has('cloze-controls')) pluginMap.set('cloze-controls', 'cloze-controls');
      if (!pluginMap.has('memory')) pluginMap.set('memory', 'memory');
    }
  }

  for (const excluded of exclusions) {
    pluginMap.delete(excluded);
  }

  const finalPluginNames = Array.from(pluginMap.keys());
  const sortedPluginNames = sortPlugins(finalPluginNames);
  
  console.log('Plugins loading order:', sortedPluginNames);

  for (const pluginName of sortedPluginNames) {
    const pluginConfig = pluginMap.get(pluginName)!;
    
    try {
      let pluginInstance: MDxPlugin | null = null;
      
      if (typeof pluginConfig === 'object' && 'install' in pluginConfig) {
        pluginInstance = pluginConfig as MDxPlugin;
      } else {
        const info = pluginRegistry.get(pluginName);
        if (!info) {
          console.warn(`Plugin with name "${pluginName}" not found in registry and could not be loaded.`);
          continue;
        }

        const PluginClass = info.constructor;
        let options = {};
        if (typeof pluginConfig === 'string') {
            options = config.defaultPluginOptions?.[pluginName] || {};
        } else if (Array.isArray(pluginConfig)) {
            const [, inlineOptions] = pluginConfig;
            const defaultOptions = config.defaultPluginOptions?.[pluginName] || {};
            options = { ...defaultOptions, ...inlineOptions };
        } else if (typeof pluginConfig === 'object' && 'name' in pluginConfig) {
            const { options: inlineOptions = {} } = pluginConfig as { name: string; options?: Record<string, any> };
            const defaultOptions = config.defaultPluginOptions?.[pluginName] || {};
            options = { ...defaultOptions, ...inlineOptions };
        }
        pluginInstance = new PluginClass(options);
      }

      if (pluginInstance) {
        editor.use(pluginInstance);
      }
    } catch (error) {
      console.error(`Failed to instantiate plugin "${pluginName}" with config:`, pluginConfig, error);
    }
  }

  return editor;
}
