// mdx/index.ts

// --- 新增的工厂函数导出 ---
export { createMDxEditor, registerPlugin } from './factory';
export type { MDxEditorFactoryConfig, PluginConfig } from './factory';

// 核心
export { PluginManager } from './core/plugin-manager';
export { ServiceContainer } from './core/service-container';
export type {
  MDxPlugin,
  PluginContext,
  ScopedPersistenceStore,
  TitleBarButtonConfig,
  ToolbarButtonConfig, // 添加了之前缺失的导出
} from './core/plugin';

// 渲染器
export { MDxRenderer } from './renderer/renderer';
export type { MDxRendererConfig, RenderOptions } from './renderer/renderer';

// 编辑器
export { MDxEditor } from './editor/editor';
export type { MDxEditorConfig } from './editor/editor';

// 插件 (导出插件类本身和它们的选项类型)

// 💡 新增：导出 CoreEditorPlugin
export { CoreEditorPlugin } from './plugins/core/core-editor.plugin';
export type { CoreEditorPluginOptions } from './plugins/core/core-editor.plugin';

export { FoldablePlugin } from './plugins/syntax-extensions/foldable.plugin';
export type { FoldablePluginOptions } from './plugins/syntax-extensions/foldable.plugin';

export { MathJaxPlugin } from './plugins/syntax-extensions/mathjax.plugin';
export type { MathJaxPluginOptions, MathJaxOptions } from './plugins/syntax-extensions/mathjax.plugin';

export { MediaPlugin } from './plugins/syntax-extensions/media.plugin';
export type { MediaPluginOptions } from './plugins/syntax-extensions/media.plugin';

export { MermaidPlugin } from './plugins/syntax-extensions/mermaid.plugin';
export type { MermaidPluginOptions } from './plugins/syntax-extensions/mermaid.plugin';

export { ClozePlugin } from './plugins/cloze/cloze.plugin';
export type { ClozePluginOptions } from './plugins/cloze/cloze.plugin';

export { ClozeControlsPlugin } from './plugins/cloze/cloze-control-ui.plugin';
export type { ClozeControlsPluginOptions } from './plugins/cloze/cloze-control-ui.plugin';

export { MemoryPlugin } from './plugins/cloze/memory.plugin';
export type { MemoryPluginOptions } from './plugins/cloze/memory.plugin';

export { TaskListPlugin } from './plugins/interactions/task-list.plugin';
export type { TaskListPluginOptions, TaskToggleDetail } from './plugins/interactions/task-list.plugin';

export { CodeBlockControlsPlugin } from './plugins/interactions/codeblock-controls.plugin';
export type { CodeBlockControlsPluginOptions } from './plugins/interactions/codeblock-controls.plugin';
