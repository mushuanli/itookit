/**
 * @file mdx/plugins/core/core-editor.plugin.ts
 * @desc 核心编辑器插件，为 MDxEditor 提供 CodeMirror 6 的基础编辑体验。
 */
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { EditorView, keymap } from '@codemirror/view';
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
  completionKeymap,
} from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import { markdown } from '@codemirror/lang-markdown';

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
      // ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
      // 修改点：将默认值从 true 改为 false。只有当用户明确传入 true 时才启用。
      enableLineNumbers: options.enableLineNumbers === true,
      // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
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

    // 自动补全
    if (this.options.enableAutocompletion) {
      extensions.push(autocompletion());
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

    if (this.options.enableAutocompletion) {
      keymaps.push(keymap.of(completionKeymap)); // 自动补全快捷键
    }

    keymaps.push(keymap.of(lintKeymap)); // 代码检查快捷键

    extensions.push(...keymaps);

    // === 5. 语言支持 (Language Support) ===

    // Markdown 语言支持
    extensions.push(markdown());

    // === 6. 核心主题与样式 (Essential Styling) ===
    // 这是关键步骤。EditorView.baseTheme 提供了所有基础 UI 元素
    // (如光标、选区、行号槽、匹配括号等)所必需的 CSS 规则。
    // 没有它，很多视觉功能将无法正常工作。
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
    // 构建核心扩展集合
    const coreExtensions = this.buildCoreExtensions();

    // 如果上下文支持注册 CodeMirror 扩展，则注册它们
    // 注意：这需要 MDxEditor 或其他宿主提供 registerCodeMirrorExtension 方法
    if (typeof (context as any).registerCodeMirrorExtension === 'function') {
      coreExtensions.forEach(ext => {
        (context as any).registerCodeMirrorExtension(ext);
      });
    } else {
      // 如果宿主不支持注册扩展，则通过依赖注入提供扩展
      // 其他组件（如编辑器初始化代码）可以通过 inject 获取这些扩展
      context.provide('coreEditorExtensions', coreExtensions);
    }

    // 监听编辑器初始化事件（如果需要进一步配置）
    const removeEditorInit = context.on('editorPostInit', (payload: any) => {
      this.onEditorInitialized(payload);
    });

    if (removeEditorInit) {
      this.cleanupFns.push(removeEditorInit);
    }
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
