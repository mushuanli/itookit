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
  EditorView,
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
      enableLineNumbers: options.enableLineNumbers ?? false,
      enableHistory: options.enableHistory ?? true,
      enableFolding: options.enableFolding ?? true,
      enableAutocompletion: options.enableAutocompletion ?? true,
      enableBracketMatching: options.enableBracketMatching ?? true,
      enableCloseBrackets: options.enableCloseBrackets ?? true,
      enableMultipleSelections: options.enableMultipleSelections ?? true,
      enableRectangularSelection: options.enableRectangularSelection ?? true,
      enableSelectionMatches: options.enableSelectionMatches ?? true,
      additionalExtensions: options.additionalExtensions ?? [],
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

    extensions.push(drawSelection(), dropCursor(), highlightActiveLine());

    // 多光标和多选择
    if (this.options.enableMultipleSelections) {
      extensions.push(EditorState.allowMultipleSelections.of(true));
    }

    // === 2. 代码智能与辅助 (Language & Autocomplete) ===

    // 自动缩进
    extensions.push(indentOnInput());

    // 语法高亮
    extensions.push(syntaxHighlighting(defaultHighlightStyle, { fallback: true }));

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
      keymap.of(searchKeymap), // 搜索快捷键 (Ctrl/Cmd+F)
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
    extensions.push(
      EditorView.baseTheme({
        // 在这里可以对基础主题进行微调，但通常保持默认即可。
        // '&.cm-focused .cm-cursor': { borderLeftColor: 'red' }
      }),
    );

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
   */
  install(context: PluginContext): void {
    const coreExtensions = this.buildCoreExtensions();
    context.registerCodeMirrorExtension?.(coreExtensions);

    if (this.options.enableAutocompletion) {
      // 使用 queueMicrotask 替代 setTimeout，更快执行
      queueMicrotask(() => {
        const pluginManager = context.pluginManager;
        if (pluginManager) {
          this.registerAutocompletion(context, pluginManager);
        } else {
          context.registerCodeMirrorExtension?.(autocompletion());
        }
      });
    }

    const removeEditorInit = context.on('editorPostInit', this.onEditorInitialized.bind(this));
    if (removeEditorInit) {
      this.cleanupFns.push(removeEditorInit);
    }
  }

  /**
   * 编辑器初始化后的回调
   */
  private onEditorInitialized(_payload: any): void {
    // 可以在这里执行一些初始化后的操作，例如：设置焦点、加载用户偏好设置等
  }

  /**
   * 销毁插件，清理所有事件监听器和资源。
   */
  destroy(): void {
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
  }

  /**
   * 统一注册自动补全扩展
   */
  private registerAutocompletion(context: PluginContext, pluginManager: any): void {
    const sources: AutocompleteSourceConfig[] = (pluginManager as any)._autocompleteSources || [];

    if (sources.length === 0) {
      context.registerCodeMirrorExtension?.(autocompletion());
      return;
    }

    const completionSource = this.createUnifiedCompletionSource(sources);
    const autocompleteExt = autocompletion({
      override: [completionSource],
      activateOnTyping: true,
      defaultKeymap: true,
      optionClass: () => '',
      activateOnTypingDelay: 0,
    });

    context.registerCodeMirrorExtension?.(autocompleteExt);
  }

  /**
   * 创建统一的补全源函数
   */
  private createUnifiedCompletionSource(sources: AutocompleteSourceConfig[]) {
    // 预处理 sources，按触发字符分组以加速查找
    const sourcesByTrigger = new Map<string, AutocompleteSourceConfig[]>();
    for (const source of sources) {
      const existing = sourcesByTrigger.get(source.triggerChar) || [];
      existing.push(source);
      sourcesByTrigger.set(source.triggerChar, existing);
    }
    
    // 获取所有触发字符用于快速检查
    const triggerChars = new Set(sourcesByTrigger.keys());

    return async (context: CompletionContext): Promise<CompletionResult | null> => {
      const { state, pos } = context;
      // [优化] 只提取当前行到光标位置的文本
      const line = state.doc.lineAt(pos);
      const lineStart = line.from;
      const textInLine = state.sliceDoc(lineStart, pos);

      // 快速检查：行内是否包含任何触发字符
      let hasTrigger = false;
      for (const trigger of triggerChars) {
        if (textInLine.includes(trigger)) {
          hasTrigger = true;
          break;
        }
      }
      if (!hasTrigger) return null;

      for (const sourceConfig of sources) {
        const { triggerChar, provider, applyTemplate, minQueryLength = 0 } = sourceConfig;
        const match = this.matchTriggerInLine(textInLine, triggerChar);

        if (!match) continue;

        const { localStart, query } = match;
        if (query.length < minQueryLength) continue;

        const suggestions = await provider.getSuggestions(query);
        if (suggestions.length === 0) continue;

        // 计算文档中的实际起始位置
        const absoluteStart = lineStart + localStart;

        const completions: Completion[] = suggestions.map((item) => {
          const completion: Completion = {
            label: item.label,
            type: item.type,
            apply: (view: EditorView, _completion: Completion, _from: number, to: number) => {
              const text = applyTemplate(item);
              view.dispatch({
                changes: { from: absoluteStart, to, insert: text },
                selection: { anchor: absoluteStart + text.length },
              });
            },
          };
          if (item.detail) completion.detail = item.detail;
          if (item.info) completion.info = item.info;
          return completion;
        });

        return {
          from: absoluteStart,
          options: completions,
          validFor: this.createValidForRegex(triggerChar),
          filter: false,
        };
      }

      return null;
    };
  }


    /**
   * [优化] 在行内文本中匹配触发字符
   * 避免搜索整个文档
     */
  private matchTriggerInLine(lineText: string, triggerChar: string): { localStart: number; query: string } | null {
    const lastTriggerIndex = lineText.lastIndexOf(triggerChar);
    if (lastTriggerIndex === -1) return null;

    // 检查触发字符前是否为空白或行首
    const charBefore = lineText[lastTriggerIndex - 1];
    if (charBefore && !/\s/.test(charBefore) && lastTriggerIndex > 0) return null;

    const query = lineText.slice(lastTriggerIndex + triggerChar.length);
    
    // 查询中不能有空白
    if (/\s/.test(query)) return null;

    return {
      localStart: lastTriggerIndex,
      query,
    };
  }

  /**
   * 根据触发字符创建 validFor 正则表达式
   */
  private createValidForRegex(triggerChar: string): RegExp {
    const escaped = triggerChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}[\\w\\u4e00-\\u9fa5-]*$`);
  }
}