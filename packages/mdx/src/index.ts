// mdx/index.ts
export { createMDxEditor, registerPlugin } from './factory';
export type { MDxEditorFactoryConfig, PluginConfig } from './factory';

export { PluginManager } from './core/plugin-manager';
export { ServiceContainer } from './core/service-container';
export type {
  MDxPlugin,
  PluginContext,
  ScopedPersistenceStore,
  TitleBarButtonConfig,
  ToolbarButtonConfig,
} from './core/plugin';

export { MDxRenderer } from './renderer/renderer';
export type { MDxRendererConfig, RenderOptions } from './renderer/renderer';

export { MDxEditor } from './editor/editor';
export type { MDxEditorConfig } from './editor/editor';

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

export { ToolbarPlugin } from './plugins/ui/toolbar.plugin';
export type { ToolbarPluginOptions } from './plugins/ui/toolbar.plugin';

export { FormattingPlugin } from './plugins/ui/formatting.plugin';
export type { FormattingPluginOptions } from './plugins/ui/formatting.plugin';

export { AutocompletePlugin } from './plugins/autocomplete/autocomplete.plugin';
export type { AutocompletePluginOptions, AutocompleteProvider, AutocompleteSourceConfig } from './plugins/autocomplete/autocomplete.plugin';

export { TagPlugin, TagProvider } from './plugins/autocomplete/tag.plugin';
export type { TagPluginOptions } from './plugins/autocomplete/tag.plugin';

export { MentionPlugin } from './plugins/autocomplete/mention.plugin';
export type { MentionPluginOptions, MentionProvider, MentionItem } from './plugins/autocomplete/mention.plugin';

