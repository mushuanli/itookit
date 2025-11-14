/**
 * @file mdx/plugins/core/core-editor.plugin.ts
 * @desc 核心编辑器插件，为 MDxEditor 提供 CodeMirror 6 的基础编辑体验。
 */
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { EditorState, type Extension } from '@codemirror/state';
import {
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection, 
  dropCursor, 
  rectangularSelection, 
  crosshairCursor,
  highlightActiveLine, 
  keymap, 
  EditorView 
} from '@codemirror/view';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { 
  foldGutter, 
  indentOnInput, 
  syntaxHighlighting, 
  defaultHighlightStyle,
  bracketMatching,
  foldKeymap,
} from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  closeBrackets,
  autocompletion,
  closeBracketsKeymap,
  type CompletionContext,
  type CompletionResult,
  type Completion,
} from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import { markdown } from '@codemirror/lang-markdown';
import type { AutocompleteSourceConfig } from '../autocomplete/autocomplete.plugin';

/**
 * 核心编辑器插件配置选项
 */
export interface CoreEditorPluginOptions {
  /**
   * 是否启用行号
   * @default false
   */
  enableLineNumbers?: boolean;

  /**
   * 是否启用历史记录（撤销/重做）
   * @default true
   */
  enableHistory?: boolean;

  /**
   * 是否启用代码折叠
   * @default true
   */
  enableFolding?: boolean;

  /**
   * 是否启用自动补全
   * @default true
   */
  enableAutocompletion?: boolean;

  /**
   * 是否启用括号匹配
   * @default true
   */
  enableBracketMatching?: boolean;

  /**
   * 是否启用括号自动闭合
   * @default true
   */
  enableCloseBrackets?: boolean;

  /**
   * 是否启用多光标选择
   * @default true
   */
  enableMultipleSelections?: boolean;

  /**
   * 是否启用矩形选择
   * @default true
   */
  enableRectangularSelection?: boolean;

  /**
   * 是否启用选中内容匹配高亮
   * @default true
   */
  enableSelectionMatches?: boolean;

  /**
   * 自定义扩展（会在核心扩展之后添加）
   */
  additionalExtensions?: Extension[];
}

/**
 * 核心编辑器插件
 * 
 * 为基于 CodeMirror 6 的 Markdown 编辑器提供完整且基础的编辑体验。
 * 
 * **设计理念**：
 * - 替代 CodeMirror 的 `basicSetup` 以避免扩展冲突
 * - 提供模块化、可配置的核心功能集
 * - 确保多实例安全和插件化架构
 * 
 * **核心功能**：
 * 1. 基础编辑功能：行号、历史记录、代码折叠、选择绘制等
 * 2. 代码智能：自动缩进、语法高亮、括号匹配、自动闭合
 * 3. 高级交互：矩形选择、多光标、选中匹配高亮
 * 4. 键盘快捷键：完整的编辑、搜索、历史、折叠等快捷键
 * 5. 语言支持：Markdown 语法解析和高亮
 * 6. 基础样式：通过 `EditorView.baseTheme` 注入核心 CSS
 */
export class CoreEditorPlugin implements MDxPlugin {
  name = 'editor:core';
  private options: Required<CoreEditorPluginOptions>;
  private cleanupFns: Array<() => void> = [];

  constructor(options: CoreEditorPluginOptions = {}) {
    this.options = {
      enableLineNumbers: options.enableLineNumbers === true,
      enableHistory: options.enableHistory !== false,
      enableFolding: options.enableFolding !== false,
      enableAutocompletion: options.enableAutocompletion !== false,
      enableBracketMatching: options.enableBracketMatching !== false,
      enableCloseBrackets: options.enableCloseBrackets !== false,
      enableMultipleSelections: options.enableMultipleSelections !== false,
      enableRectangularSelection: options.enableRectangularSelection !== false,
      enableSelectionMatches: options.enableSelectionMatches !== false,
      additionalExtensions: options.additionalExtensions || [],
    };
  }

  /**
   * 构建核心扩展集合
   * 
   * 这个方法精心组合了 CodeMirror 的各个模块，形成一个完整的编辑器体验。
   * 每个扩展都是可选的，可以通过配置禁用。
   */
  private buildCoreExtensions(): Extension[] {
    const extensions: Extension[] = [];

    // === 1. 基础编辑功能 (Essentials & View) ===
    
    // 行号显示
    if (this.options.enableLineNumbers) {
      extensions.push(lineNumbers(), highlightActiveLineGutter());
    }

    // 特殊字符高亮（空格、制表符等）
    extensions.push(highlightSpecialChars());

    // 历史记录（撤销/重做）
    if (this.options.enableHistory) {
      extensions.push(history());
    }

    // 代码折叠
    if (this.options.enableFolding) {
      extensions.push(foldGutter());
    }

    // 选择区域绘制
    extensions.push(drawSelection());

    // 拖放光标显示
    extensions.push(dropCursor());

    // 当前行高亮
    extensions.push(highlightActiveLine());

    // 多光标和多选择
    if (this.options.enableMultipleSelections) {
      extensions.push(EditorState.allowMultipleSelections.of(true));
    }

    // === 2. 代码智能与辅助 (Language & Autocomplete) ===

    // 自动缩进
    extensions.push(indentOnInput());

    // 语法高亮
    extensions.push(
      syntaxHighlighting(defaultHighlightStyle, { fallback: true })
    );

    // 括号匹配
    if (this.options.enableBracketMatching) {
      extensions.push(bracketMatching());
    }

    // 括号自动闭合
    if (this.options.enableCloseBrackets) {
      extensions.push(closeBrackets());
    }

    // === 3. 高级编辑与交互 (Advanced Editing & Interaction) ===

    // 矩形选择
    if (this.options.enableRectangularSelection) {
      extensions.push(rectangularSelection(), crosshairCursor());
    }

    // 选中内容匹配高亮
    if (this.options.enableSelectionMatches) {
      extensions.push(highlightSelectionMatches());
    }

    // === 4. 键盘快捷键 (Keymaps) ===

    const keymaps: Extension[] = [
      keymap.of(defaultKeymap), // 基础快捷键（光标移动、删除等）
      keymap.of(searchKeymap),  // 搜索快捷键 (Ctrl/Cmd+F)
    ];

    if (this.options.enableHistory) {
      keymaps.push(keymap.of(historyKeymap)); // 撤销/重做快捷键
    }

    if (this.options.enableFolding) {
      keymaps.push(keymap.of(foldKeymap)); // 代码折叠快捷键
    }

    if (this.options.enableCloseBrackets) {
      keymaps.push(keymap.of(closeBracketsKeymap)); // 括号闭合快捷键
    }
    

    keymaps.push(keymap.of(lintKeymap)); // 代码检查快捷键

    extensions.push(...keymaps);

    // === 5. 语言支持 (Language Support) ===

    // Markdown 语言支持
    extensions.push(markdown());

    // === 6. 核心主题与样式 (Essential Styling) ===
    extensions.push(EditorView.baseTheme({
      // 在这里可以对基础主题进行微调，但通常保持默认即可。
      // '&.cm-focused .cm-cursor': { borderLeftColor: 'red' }
    }));

    // === 7. 用户自定义扩展 ===

    if (this.options.additionalExtensions.length > 0) {
      extensions.push(...this.options.additionalExtensions);
    }

    return extensions;
  }

  /**
   * 安装插件
   * 
   * 该方法会在编辑器初始化时被调用，注册所有核心扩展。
   * 每个编辑器实例都会独立调用此方法，确保多实例安全。
   */
  install(context: PluginContext): void {
  console.log('🚀 [CoreEditorPlugin] Installing...');
  
  const coreExtensions = this.buildCoreExtensions();
  context.registerCodeMirrorExtension?.(coreExtensions);
  console.log(`🚀 [CoreEditorPlugin] Registered ${coreExtensions.length} core extensions`);

  if (this.options.enableAutocompletion) {
    console.log('⏰ [CoreEditorPlugin] Scheduling autocomplete registration with setTimeout(0)...');
    setTimeout(() => {
      console.log('⏰ [CoreEditorPlugin] setTimeout callback executing NOW');
      const pluginManager = context.pluginManager;
      
      if (pluginManager) {
        const sourcesCount = (pluginManager as any)._autocompleteSources?.length || 0;
        console.log(`⏰ [CoreEditorPlugin] Found ${sourcesCount} autocomplete sources`);
        this.registerAutocompletion(context, pluginManager);
      } else {
        console.warn('⏰ [CoreEditorPlugin] pluginManager not found!');
        context.registerCodeMirrorExtension?.(autocompletion());
      }
    }, 0);
  }

    const removeEditorInit = context.on('editorPostInit', this.onEditorInitialized.bind(this));
    if (removeEditorInit) {
      this.cleanupFns.push(removeEditorInit);
    }
  console.log('🚀 [CoreEditorPlugin] Installation complete');
  }

  /**
   * 编辑器初始化后的回调
   * 
   * 可以在这里进行额外的编辑器配置或状态初始化
   */
  private onEditorInitialized(payload: any): void {
    // 可以在这里执行一些初始化后的操作
    // 例如：设置焦点、加载用户偏好设置等
    console.log(`[${this.name}] Editor initialized with core extensions`);
  }

  /**
   * 销毁插件
   * 
   * 清理所有事件监听器和资源
   */
  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }

  // === 移植点 6: 复制文件2的所有自动补全相关方法 ===

  /**
   * 统一注册自动补全扩展
   */
  private registerAutocompletion(context: PluginContext, pluginManager: any): void {
    const sources: AutocompleteSourceConfig[] = (pluginManager as any)._autocompleteSources || [];
    
  console.log(`🎯 [CoreEditorPlugin] registerAutocompletion called with ${sources.length} sources`);
    if (sources.length === 0) {
      console.log(`[${this.name}] No autocomplete sources found. Registering default markdown autocompletion.`);
      // 如果没有自定义源，可以注册一个默认的作为降级
      context.registerCodeMirrorExtension?.(autocompletion());
      return;
    }

  console.log('🎯 [CoreEditorPlugin] Creating unified completion source...');
    const completionSource = this.createUnifiedCompletionSource(sources);
    const autocompleteExt = autocompletion({
      override: [completionSource],
      activateOnTyping: true,
    });

    context.registerCodeMirrorExtension?.(autocompleteExt);
    console.log(`[${this.name}] Registered unified autocompletion with ${sources.length} sources.`);
  }

  /**
   * 创建统一的补全源函数
   */
  private createUnifiedCompletionSource(sources: AutocompleteSourceConfig[]) {
    return async (context: CompletionContext): Promise<CompletionResult | null> => {
      const { state, pos } = context;
      const textBefore = state.sliceDoc(0, pos);
    console.log(`🔍 [Autocomplete] Triggered at pos ${pos}, text: "${textBefore.slice(-20)}"`);

      for (const sourceConfig of sources) {
        const { triggerChar, provider, applyTemplate, minQueryLength = 0 } = sourceConfig;
        const match = this.matchTrigger(textBefore, triggerChar);

        if (!match) continue;

      console.log(`🎯 [Autocomplete] Matched trigger "${triggerChar}", query: "${match.query}"`);
        const { start, query } = match;
      if (query.length < minQueryLength) {
        console.log(`⏩ [Autocomplete] Query too short (${query.length} < ${minQueryLength})`);
        continue;
      }

      const suggestions = await provider.getSuggestions(query);
      console.log(`📋 [Autocomplete] Got ${suggestions.length} suggestions for "${query}"`);
      
      if (suggestions.length === 0) continue;

      const completions = suggestions.map((item) => ({
        ...item,
        apply: (view: EditorView, completion: any, from: number, to: number) => {
          const text = applyTemplate(item);
          console.log(`✏️ [Autocomplete] Applying: "${text}"`);
          view.dispatch({
            changes: { from: start, to, insert: text },
            selection: { anchor: start + text.length },
          });
        },
      }));

        return {
          from: start,
          options: completions,
          validFor: /^[\w-]*$/,
        };
      }

    console.log('❌ [Autocomplete] No matches found');
      return null;
    };
  }

  /**
   * 匹配触发字符和查询词
   */
  private matchTrigger(
    text: string,
    triggerChar: string
  ): { start: number; query: string } | null {
    const lastTriggerIndex = text.lastIndexOf(triggerChar);
    if (lastTriggerIndex === -1) return null;

    const charBefore = text[lastTriggerIndex - 1];
    if (charBefore && !/\s/.test(charBefore) && lastTriggerIndex > 0) return null;

    const query = text.slice(lastTriggerIndex + 1);
    if (/\s/.test(query)) return null;

    return {
      start: lastTriggerIndex,
      query,
    };
  }
}

/**
 * 使用示例：
 * 
 * ```typescript
 * import { createMDxEditor } from './mdx/factory';
 * 
 * // 使用默认配置 (CoreEditorPlugin 会被自动加载)
 * const editor1 = createMDxEditor();
 * 
 * // 自定义配置 (通过 defaultPluginOptions)
 * const editor2 = createMDxEditor({
 *   defaultPluginOptions: {
 *     'editor:core': {
 *       enableLineNumbers: false,
 *       enableFolding: false
 *     }
 *   }
 * });
 * ```
 */
