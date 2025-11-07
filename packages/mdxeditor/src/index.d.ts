// index.d.ts for @itookit/mdxeditor

import type { EditorView, ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { Renderer, Token, Tokens } from 'marked';

// ============================================================================
// Core Interfaces from @itookit/common
// ============================================================================

export interface IMentionProvider {
  key: string;
  triggerChar: string;
  getSuggestions(query: string): Promise<Array<{ id: string; label: string }>>;
  getDataForProcess?(url: URL): Promise<any>;
  getContentForTransclusion?(url: URL): Promise<string | null>;
  getHoverPreview?(url: URL): Promise<HTMLElement | string | null>;
  handleClick?(url: URL): void;
}

export interface IAutocompleteProvider {
  getSuggestions(query: string): Promise<Array<{ id: string; label: string }>>;
}

export interface IPersistenceAdapter {
  getItem(key: string): Promise<any | null>;
  setItem(key: string, value: any): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface IEditor {
  getText(): string;
  setText(text: string): void;
  getSummary(): Promise<any | null>;
  navigateTo(target: { elementId: string }, options?: { smooth?: boolean }): Promise<void>;
  setReadOnly(isReadOnly: boolean): void;
  focus(): void;
  destroy(): void;
}

// ============================================================================
// Utility Functions
// ============================================================================

export function slugify(text: string): string;
export function simpleHash(text: string): string;
export function escapeHTML(text: string): string;

// ============================================================================
// MDxProcessor (Headless Processing Engine)
// ============================================================================

export interface ProcessOptions {
  rules: {
    [providerKey: string]: ProviderProcessRule;
  };
}

export interface ProviderProcessRule {
  action: 'replace' | 'remove' | 'keep';
  getReplacementContent?(data: any, mention: MentionMatch): string;
  collectMetadata?: boolean;
}

export interface MentionMatch {
  raw: string;
  type: string;
  id: string;
  uri: string;
  index: number;
  data: any;
}

export interface ProcessResult {
  originalContent: string;
  transformedContent: string;
  mentions: MentionMatch[];
  metadata: { [type: string]: string[] };
}

export class MDxProcessor {
  constructor(providers?: IMentionProvider[]);
  register(provider: IMentionProvider): void;
  process(markdownText: string, options: ProcessOptions): Promise<ProcessResult>;
}

// ============================================================================
// Plugin System
// ============================================================================

export interface ScopedPersistenceStore {
  get(key: string): Promise<any | null>;
  set(key: string, value: any): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ToolbarButton {
  id: string;
  title?: string;
  icon: string | HTMLElement;
  command?: string;
  location?: 'left' | 'right' | 'mode-switcher';
  type?: 'separator';
}

export interface TitleBarButton {
  id: string;
  title?: string;
  icon: string;
  location?: 'left' | 'right';
  command?: string;
  onClick?(editor: MDxEditor): void;
}

export interface PluginContext {
  registerSyntaxExtension(extension: any): void;
  on(hook: 'beforeParse' | 'afterRender' | 'domUpdated', callback: Function): void;
  emit(eventName: string, payload: any): void;
  listen(eventName: string, callback: (payload: any) => void): void;
  provide(key: symbol | string, service: any): void;
  inject<T = any>(key: symbol | string): T | undefined;
  getScopedStore(): ScopedPersistenceStore;
  registerCommand(name: string, fn: (editor: MDxEditor) => void): void;
  registerToolbarButton(config: ToolbarButton): void;
  registerTitleBarButton(config: TitleBarButton): void;
  registerCodeMirrorExtension(extension: Extension | Extension[]): void;
  renderInElement(element: HTMLElement, markdown: string): Promise<void>;
  findAndSelectText(text: string): void;
  switchToMode(mode: 'edit' | 'render'): void;
}

export interface MDxPlugin {
  name: string;
  install(context: PluginContext): void;
  destroy?(): void;
}

// ============================================================================
// Core UI Components
// ============================================================================

export interface MDxCoreEditorOptions {
  initialText?: string;
  extensions?: Extension[];
  onUpdate?(update: ViewUpdate): void;
}

export class MDxCoreEditor {
  view: EditorView;
  constructor(parentElement: HTMLElement, options: MDxCoreEditorOptions);
  getText(): string;
  setText(markdownText: string): void;
  focus(): void;
  get scrollDOM(): HTMLElement;
  destroy(): void;
}

export interface MDxRendererConfig {
  markedOptions?: any;
}

export class MDxRenderer {
  constructor(plugins?: MDxPlugin[], config?: MDxRendererConfig);
  use(plugin: MDxPlugin): this;
  render(element: HTMLElement, markdownText: string, options?: any): Promise<void>;
  search(query: string): HTMLElement[];
  gotoMatch(matchElement: HTMLElement): void;
  clearSearch(): void;
  configureMarked(options: any): void;
  destroy(): void;
}

// ============================================================================
// MDxEditor
// ============================================================================

export type SearchResultSource = 'editor' | 'renderer';

export interface UnifiedSearchResult {
  source: SearchResultSource;
  text: string;
  context: string;
  details: any;
}

export interface MDxEditorOptions {
  plugins?: MDxPlugin[];
  initialText?: string;
  showToolbar?: boolean;
  showTitleBar?: boolean;
  initialMode?: 'edit' | 'render';
  dataAdapter?: IPersistenceAdapter;
  clozeControls?: boolean;
  titleBar?: {
    title?: string;
    toggleSidebarCallback?(): void;
    enableToggleEditMode?: boolean;
    aiCallback?(text: string): void;
    saveCallback?(text: string): void;
    printCallback?(): void;
  };
}

export class MDxEditor implements IEditor {
  container: HTMLElement;
  options: MDxEditorOptions;
  mode: 'edit' | 'render';
  editorView: EditorView;
  editorEl: HTMLElement | null;
  renderEl: HTMLElement | null;
  
  readonly commands: Readonly<{ [name: string]: Function }>;

  constructor(container: HTMLElement, options?: MDxEditorOptions);
  
  // IEditor implementation
  getText(): string;
  setText(markdownText: string): void;
  getSummary(): Promise<any | null>;
  navigateTo(target: { elementId: string }, options?: { smooth?: boolean }): Promise<void>;
  setReadOnly(isReadOnly: boolean): void;
  focus(): void;
  destroy(): void;

  // MDxEditor specific
  setTitle(newTitle: string): void;
  on(eventName: 'change' | 'interactiveChange' | 'ready' | 'modeChanged', callback: (payload?: any) => void): () => void;
  use(plugin: MDxPlugin): this;
  getService<T = any>(key: symbol | string): T | undefined;
  toggleMode(): void;
  switchTo(mode: 'edit' | 'render', isInitial?: boolean): void;
  search(query: string): Promise<UnifiedSearchResult[]>;
  gotoMatch(result: UnifiedSearchResult): void;
  clearSearch(): void;
}

// ============================================================================
// Built-in Plugins
// ============================================================================

export class ClozePlugin implements MDxPlugin {
  name: 'feature:cloze';
  install(context: PluginContext): void;
}

export const ClozeAPIKey: symbol;

export interface ClozeControlsPluginOptions {}

export class ClozeControlsPlugin implements MDxPlugin {
  name: 'feature:cloze-controls';
  constructor(options?: ClozeControlsPluginOptions);
  install(context: PluginContext): void;
  destroy(): void;
}

export interface MemoryPluginOptions {
  matureInterval?: number;
  gradingTimeout?: number;
}

export class MemoryPlugin implements MDxPlugin {
  name: 'feature:memory';
  constructor(options?: MemoryPluginOptions);
  install(context: PluginContext): void;
  destroy(): void;
}

export class FoldablePlugin implements MDxPlugin {
  name: 'core:foldable';
  install(context: PluginContext): void;
}

export class FormattingPlugin implements MDxPlugin {
  name: 'feature:formatting';
  install(context: PluginContext): void;
}

export class MathJaxPlugin implements MDxPlugin {
  name: 'feature:mathjax';
  install(context: PluginContext): void;
}

export class MediaPlugin implements MDxPlugin {
  name: 'feature:media';
  install(context: PluginContext): void;
}

export class MermaidPlugin implements MDxPlugin {
  name: 'feature:mermaid';
  install(context: PluginContext): void;
}

export class TaskListPlugin implements MDxPlugin {
  name: 'core:task-list';
  install(context: PluginContext): void;
}

export interface CodeBlockControlsPluginOptions {
  collapseThreshold?: number;
}

export class CodeBlockControlsPlugin implements MDxPlugin {
  name: 'feature:codeblock-controls';
  constructor(options?: CodeBlockControlsPluginOptions);
  install(context: PluginContext): void;
}

export class MentionPlugin implements MDxPlugin {
  name: 'feature:mention';
  constructor(options: { providers: IMentionProvider[] });
  install(context: PluginContext): void;
}

export class TagPlugin implements MDxPlugin {
  name: 'feature:tags';
  constructor(options: { getTags: () => Promise<string[]> });
  install(context: PluginContext): void;
}

export class TagProvider implements IAutocompleteProvider {
  constructor(options: { getTags: () => Promise<string[]> });
  getSuggestions(query: string): Promise<Array<{ id: string; label: string }>>;
}

export interface AutocompleteSourceOptions {
  triggerChar: string;
  provider: IAutocompleteProvider;
  applyTemplate(item: { id: string; label: string; [key: string]: any }): string;
  completionType?: string;
}

export class AutocompletePlugin implements MDxPlugin {
  name: 'feature:autocomplete';
  constructor(options: { sources: AutocompleteSourceOptions[] });
  install(context: PluginContext): void;
}

// ============================================================================
// Editor Commands
// ============================================================================

export function applyMarkdownFormatting(view: EditorView, formattingChars: string): void;
export function applyCloze(view: EditorView): void;
export function applyAudioCloze(view: EditorView): void;
export function insertLinebreak(view: EditorView): void;
export function toggleHeading(view: EditorView): void;
export function toggleUnorderedList(view: EditorView): void;
export function toggleOrderedList(view: EditorView): void;
export function toggleTaskList(view: EditorView): void;
export function toggleBlockquote(view: EditorView): void;
export function applyCodeBlock(view: EditorView): void;
export function insertHorizontalRule(view: EditorView): void;
export function applyLink(view: EditorView): void;
export function insertImage(view: EditorView): void;
export function insertTable(view: EditorView): void;
export function handleAIAction(view: EditorView, callback: (text: string) => void): void;
export function handleSaveAction(view: EditorView, callback: (text: string) => void): void;
export function handlePrintAction(editor: MDxEditor): Promise<void>;

// ============================================================================
// Default Plugin Bundle
// ============================================================================

export const defaultPlugins: MDxPlugin[];
