// mdx/editor/commands.ts

import { EditorView } from '@codemirror/view';
import { EditorSelection, ChangeSpec } from '@codemirror/state';
import type { MDxEditor } from './editor';

/**
 * 命令函数类型定义
 */
export type CommandFunction = (view: EditorView) => boolean;

/**
 * 应用通用 Markdown 格式化（加粗、斜体、删除线等）
 */
export function applyMarkdownFormatting(
  view: EditorView,
  marker: string
): boolean {
  const { state, dispatch } = view;
  const { from, to } = state.selection.main;
  const selectedText = state.sliceDoc(from, to);

  const before = state.sliceDoc(Math.max(0, from - marker.length), from);
  const after = state.sliceDoc(to, Math.min(state.doc.length, to + marker.length));

  if (before === marker && after === marker) {
    dispatch({
      changes: [
        { from: from - marker.length, to: from, insert: '' },
        { from: to, to: to + marker.length, insert: '' }
      ]
    });
  } else {
    dispatch({
      changes: { from, to, insert: `${marker}${selectedText}${marker}` },
      selection: { anchor: from + marker.length, head: to + marker.length }
    });
  }
  view.focus();
  return true;
}

export const applyBold: CommandFunction = (view) => applyMarkdownFormatting(view, '**');
export const applyItalic: CommandFunction = (view) => applyMarkdownFormatting(view, '*');
export const applyStrikethrough: CommandFunction = (view) => applyMarkdownFormatting(view, '~~');
export const applyInlineCode: CommandFunction = (view) => applyMarkdownFormatting(view, '`');
export const applyHighlight: CommandFunction = (view) => applyMarkdownFormatting(view, '==');

/**
 * Cloze 匹配信息
 */
interface ClozeMatch {
  start: number;
  end: number;
  content: string;
}

/**
 * [优化] 智能应用 Cloze 语法 - 单次正则遍历
 */
export function applyCloze(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const docString = doc.toString();

  // 一次性收集所有 Cloze 匹配
  const clozeRegex = /--.*?--/gd;
  const allMatches: ClozeMatch[] = [];
  
  for (const match of docString.matchAll(clozeRegex)) {
    const indices = match.indices?.[0];
    if (indices) {
      allMatches.push({
        start: indices[0],
        end: indices[1],
        content: match[0]
      });
    }
  }

  // 检查是否在现有 Cloze 内部 - 如果是则移除
  for (const { start, end, content } of allMatches) {
    if (from >= start + 2 && to <= end - 2) {
      const plainContent = content.substring(2, content.length - 2)
        .replace(/(\s*\[[^\]]*\]\s*)?(\^\^.*?\^\^)?$/, '');

      view.dispatch({
        changes: { from: start, to: end, insert: plainContent },
        selection: { anchor: start, head: start + plainContent.length }
      });
      view.focus();
      return true;
    }
  }

  // 检查选区是否与现有 Cloze 相邻或重叠，需要合并
  let modificationStart = from;
  let modificationEnd = to;

  for (const { start, end } of allMatches) {
    const isTouching = (
      (modificationStart >= start && modificationStart <= end) ||
      (modificationEnd >= start && modificationEnd <= end) ||
      (modificationStart <= start && modificationEnd >= end) ||
      (doc.sliceString(end, modificationStart).trim() === '' && end <= modificationStart) ||
      (doc.sliceString(modificationEnd, start).trim() === '' && modificationEnd <= start)
    );

    if (isTouching) {
      modificationStart = Math.min(modificationStart, start);
      modificationEnd = Math.max(modificationEnd, end);
    }
  }

  // 移除已存在的 Cloze 标记
  const contentToWrap = doc.sliceString(modificationStart, modificationEnd).replace(/--/g, '');
  
  if (!contentToWrap.trim()) {
    view.focus();
    return true;
  }
  
  const locator = `c${Date.now()}`;
  const newText = `--[${locator}] ${contentToWrap.trim()}--`;

  view.dispatch({
    changes: { from: modificationStart, to: modificationEnd, insert: newText },
    selection: { anchor: modificationStart + 2, head: modificationStart + newText.length - 2 }
  });
  view.focus();
  return true;
}

/**
 * 为选区添加带音频的 Cloze
 */
export function applyAudioCloze(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  if (from === to) {
    alert("请先选择要制作成 Cloze 的文本。");
    return false;
  }
  
  const selectedText = state.doc.sliceString(from, to);
  const audioText = prompt("请输入音频提示文本:", selectedText);
  if (audioText === null) return false;

  const newText = `--${selectedText}--^^audio:${audioText.trim()}^^`;
  
  view.dispatch({
    changes: { from, to, insert: newText }
  });
  view.focus();
  return true;
}

/**
 * 插入换行符 (¶)
 */
export function insertLinebreak(view: EditorView): boolean {
  view.dispatch({
    changes: { from: view.state.selection.main.from, insert: "¶" }
  });
  view.focus();
  return true;
}

/**
 * [优化] 切换行前缀 - 减少重复遍历
 */
function toggleLinePrefix(view: EditorView, prefix: string): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;

  const fromLine = state.doc.lineAt(from);
  const toLine = state.doc.lineAt(to);
  
  const changes: ChangeSpec[] = [];
  
  // 预分配数组，一次遍历完成检测和收集
  const lineInfos: Array<{ line: typeof fromLine; hasPrefix: boolean }> = [];
  let allLinesHavePrefix = true;
  
  for (let i = fromLine.number; i <= toLine.number; i++) {
    const line = state.doc.line(i);
    const hasPrefix = line.length > 0 && line.text.trimStart().startsWith(prefix);
    lineInfos.push({ line, hasPrefix });
    if (line.length > 0 && !hasPrefix) {
      allLinesHavePrefix = false;
    }
  }

  // 根据检测结果生成变更
  for (const { line, hasPrefix } of lineInfos) {
    if (allLinesHavePrefix) {
      // 移除前缀
      if (line.text.includes(prefix)) {
        const prefixIndex = line.text.indexOf(prefix);
        changes.push({ 
          from: line.from + prefixIndex, 
          to: line.from + prefixIndex + prefix.length, 
          insert: '' 
        });
      }
    } else if (line.length > 0 && !hasPrefix) {
      // 添加前缀
      changes.push({ from: line.from, insert: prefix });
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  view.focus();
  return true;
}

export const toggleUnorderedList: CommandFunction = (view) => toggleLinePrefix(view, '- ');
export const toggleOrderedList: CommandFunction = (view) => toggleLinePrefix(view, '1. ');
export const toggleTaskList: CommandFunction = (view) => toggleLinePrefix(view, '- [ ] ');
export const toggleBlockquote: CommandFunction = (view) => toggleLinePrefix(view, '> ');

/**
 * 切换标题级别
 */
export const toggleHeading: CommandFunction = (view) => {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const text = line.text;

  let change: ChangeSpec;
  if (text.startsWith('## ')) {
    change = { from: line.from, to: line.from + 3, insert: '### ' };
  } else if (text.startsWith('### ')) {
    change = { from: line.from, to: line.from + 4, insert: '' };
  } else {
    change = { from: line.from, insert: '## ' };
  }
  
  view.dispatch({ changes: [change] });
  view.focus();
  return true;
};

/**
 * 插入水平分割线
 */
export function insertHorizontalRule(view: EditorView): boolean {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const insertPos = line.to;
  const insertText = (line.length > 0 ? '\n\n---\n' : '\n---\n');
  
  view.dispatch({
    changes: { from: insertPos, insert: insertText },
    selection: EditorSelection.cursor(insertPos + insertText.length)
  });
  view.focus();
  return true;
}

/**
 * 插入表格
 */
export function insertTable(view: EditorView): boolean {
  const rowsStr = prompt('行数：', '3');
  const colsStr = prompt('列数：', '3');

  if (!rowsStr || !colsStr) return false;

  const rowCount = parseInt(rowsStr, 10);
  const colCount = parseInt(colsStr, 10);

  if (isNaN(rowCount) || isNaN(colCount) || rowCount < 1 || colCount < 1) {
    alert("请输入有效的行数和列数。");
    return false;
  }

  // [优化] 使用数组 join 替代字符串拼接
  const headerCells = Array(colCount).fill('标题').join(' | ');
  const separatorCells = Array(colCount).fill('---').join(' | ');
  const bodyCells = Array(colCount).fill('单元格').join(' | ');
  
  const lines = [
    '',
    `| ${headerCells} |`,
    `| ${separatorCells} |`,
    ...Array(rowCount - 1).fill(`| ${bodyCells} |`),
    ''
  ];
  
  const table = lines.join('\n');

  view.dispatch({
    changes: { from: view.state.selection.main.from, insert: table }
  });
  view.focus();
  return true;
}

/**
 * 应用代码块
 */
export function applyCodeBlock(view: EditorView): boolean {
  const lang = prompt('编程语言 (可选):', '');
  const { state } = view;
  const { from, to } = state.selection.main;
  const selectedText = state.sliceDoc(from, to) || '代码';

  const newText = `\`\`\`${lang || ''}\n${selectedText}\n\`\`\``;

  view.dispatch({
    changes: { from, to, insert: newText },
    selection: EditorSelection.cursor(from + 4 + (lang?.length || 0))
  });
  view.focus();
  return true;
}

/**
 * 应用链接
 */
export function applyLink(view: EditorView): boolean {
  const url = prompt('请输入链接 URL:', 'https://');
  if (!url) return false;

  const { state } = view;
  const { from, to } = state.selection.main;
  const selectedText = state.sliceDoc(from, to);
  
  const linkText = selectedText || '链接文本';
  const newText = `[${linkText}](${url})`;

  view.dispatch({
    changes: { from, to, insert: newText },
    selection: { anchor: from + 1, head: from + 1 + linkText.length }
  });
  view.focus();
  return true;
}

/**
 * 插入图片
 */
export function insertImage(view: EditorView): boolean {
  const url = prompt('请输入图片 URL:', 'https://');
  if (!url) return false;

  const { state } = view;
  const { from, to } = state.selection.main;
  const altText = state.sliceDoc(from, to) || '图片描述';
  const newText = `![${altText}](${url})`;
  
  view.dispatch({
    changes: { from, to, insert: newText }
  });
  view.focus();
  return true;
}

/**
 * 触发 AI 回调
 */
export function handleAIAction(view: EditorView, callback: (content: string) => void): boolean {
  if (typeof callback !== 'function') {
    console.warn("AI callback is not a function.");
    return false;
  }
  const { from, to } = view.state.selection.main;
  const selectedText = view.state.doc.sliceString(from, to);
  
  const textToProcess = selectedText.length > 0 ? selectedText : view.state.doc.toString();
  
  callback(textToProcess);
  view.focus();
  return true;
}

/**
 * 触发保存回调
 */
export function handleSaveAction(view: EditorView, callback: (content: string) => void): boolean {
  if (typeof callback !== 'function') {
    console.warn("Save callback is not a function.");
    return false;
  }
  const fullText = view.state.doc.toString();
  callback(fullText);
  view.focus();
  return true;
}

/**
 * 触发浏览器打印功能
 */
export async function handlePrintAction(editor: MDxEditor): Promise<boolean> {
  let printContainer = document.getElementById('mdx-print-container');
  if (!printContainer) {
    printContainer = document.createElement('div');
    printContainer.id = 'mdx-print-container';
    printContainer.className = 'rich-content-area';
    document.body.appendChild(printContainer);
  }
  
  try {
    if (editor.getMode() === 'render') {
      const renderEl = editor.getRenderContainer();
      if (renderEl) {
        printContainer.innerHTML = renderEl.innerHTML;
      }
    } else {
      const latestMarkdown = editor.getText();
      await editor.getRenderer().render(printContainer, latestMarkdown, {
        areAllClozesVisible: true 
      });
    }
    
    document.body.classList.add('mdx-printing');
    window.print();
  } catch (error) {
    console.error("Printing failed:", error);
    return false;
  } finally {
    document.body.classList.remove('mdx-printing');
    if (printContainer) {
      printContainer.innerHTML = '';
    }
    if (editor.getMode() === 'edit') {
      const view = editor.getEditorView();
      if (view) {
        view.focus();
      }
    }
  }
  return true;
}
