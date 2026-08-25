/// <reference path="./types/turndown-plugin-gfm.d.ts" />

// @mdx/index.ts
export { createMDxEditor, defaultEditorFactory, registerPlugin } from './factory';
export type { MDxEditorFactoryConfig, PluginConfig } from './factory';

// === 编辑器 ===
export { MDxEditor } from './editor/mdx-editor';
export type { MDxEditorConfig } from './editor/mdx-editor';

// === 渲染器 ===
export { MDxRenderer } from './renderer/mdx-renderer';
export type { MDxRendererConfig, RenderOptions } from './renderer/mdx-renderer';

// === 核心框架 ===
export { PluginManager } from './core/plugin-manager';
export { EventBus } from './core/event-bus';
export { ServiceContainer } from './core/service-container';
export type {
  MDxPlugin,
  PluginContext,
  ScopedPersistenceStore,
  ToolbarButtonConfig,
  TitleBarButtonConfig,
} from './core/types';

// === 服务 ===
export { MDxProcessor } from './services/processor';
export type { ProcessOptions, ProcessResult, MentionMatch } from './services/processor';

export { DefaultPrintService, LLMPrintService } from './services/print/print.service';
export type { PrintService, PrintOptions } from './services/print/print.service';

export {
  generateAssetPath,
  extractFilenameFromPath,
  isAssetVisible,
  getUploadLimits,
  DEFAULT_UPLOAD_LIMITS,
} from './services/asset-helper';

// === 插件（保持原有导出） ===
export { CoreEditorPlugin } from './plugins/core/core-editor.plugin';
export type { CoreEditorPluginOptions } from './plugins/core/core-editor.plugin';

export { FoldablePlugin } from './plugins/syntax-extensions/foldable.plugin';
export type { FoldablePluginOptions } from './plugins/syntax-extensions/foldable.plugin';

export { MathJaxPlugin } from './plugins/syntax-extensions/mathjax.plugin';
export type { MathJaxPluginOptions, MathJaxOptions } from './plugins/syntax-extensions/mathjax.plugin';

export { MediaPlugin } from './plugins/syntax-extensions/media.plugin';
export type { MediaPluginOptions } from './plugins/syntax-extensions/media.plugin';

export { SvgPlugin } from './plugins/syntax-extensions/svg.plugin';
export type { SvgPluginOptions } from './plugins/syntax-extensions/svg.plugin';

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

export { TablePlugin } from './plugins/interactions/table.plugin';
export type { TablePluginOptions } from './plugins/interactions/table.plugin';

export { CodeBlockControlsPlugin } from './plugins/interactions/codeblock-controls.plugin';
export type { CodeBlockControlsPluginOptions } from './plugins/interactions/codeblock-controls.plugin';

export { ZoomPlugin } from './plugins/interactions/zoom.plugin';
export type { ZoomPluginOptions } from './plugins/interactions/zoom.plugin';

export { ToolbarPlugin } from './plugins/ui/toolbar.plugin';
export type { ToolbarPluginOptions } from './plugins/ui/toolbar.plugin';

export { FormattingPlugin } from './plugins/ui/formatting.plugin';
export type { FormattingPluginOptions } from './plugins/ui/formatting.plugin';

export { AssetManagerUI } from './plugins/ui/asset-manager.ui';

export { AutocompletePlugin } from './plugins/autocomplete/autocomplete.plugin';
export type { AutocompletePluginOptions, AutocompleteProvider, AutocompleteSourceConfig } from './plugins/autocomplete/autocomplete.plugin';

export { TagPlugin, TagAutocompleteSource } from './plugins/autocomplete/tag.plugin';
export type { TagPluginOptions } from './plugins/autocomplete/tag.plugin';

export { MentionPlugin } from './plugins/autocomplete/mention.plugin';
export type { MentionPluginOptions, MentionProvider, MentionItem } from './plugins/autocomplete/mention.plugin';

