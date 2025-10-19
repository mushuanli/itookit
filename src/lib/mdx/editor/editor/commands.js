// #mdx/editor/editor/commands.js

/**
 * 智能地将 Markdown 格式化字符包裹在选区周围。
 * 如果选区已被该格式包裹，则移除包裹。
 * @param {import("@codemirror/view").EditorView} view
 * @param {string} formattingChars - 例如 "**" 或 "*"
 */
export function applyMarkdownFormatting(view, formattingChars) {
    const { from, to } = view.state.selection.main;
    const selectedText = view.state.doc.sliceString(from, to);

    const before = view.state.doc.sliceString(Math.max(0, from - formattingChars.length), from);
    const after = view.state.doc.sliceString(to, to + formattingChars.length);

    // 如果已经包裹，则移除
    if (before === formattingChars && after === formattingChars) {
        view.dispatch({
            changes: [
                { from: from - formattingChars.length, to: from, insert: '' },
                { from: to, to: to + formattingChars.length, insert: '' }
            ]
        });
    } else { // 否则，添加包裹
        const newText = `${formattingChars}${selectedText}${formattingChars}`;
        view.dispatch({
            changes: { from, to, insert: newText },
            selection: { anchor: from + formattingChars.length }
        });
    }
    view.focus();
}

/**
 * [已完善] 智能应用 Cloze 语法 (--text--)。
 * - 如果选区已被包裹，则移除。
 * - 如果选区与现有 Cloze 相邻或重叠，则合并它们。
 * @param {import("@codemirror/view").EditorView} view
 */
export function applyCloze(view) {
    const { from, to } = view.state.selection.main;
    const doc = view.state.doc.toString();
    const docLength = doc.length;

    // [MODIFIED] 使用带 'd' 标志的正则表达式来获取匹配项的索引
    const clozeRegex = /--.*?--/gd;
    
    // 1. 检查选区是否在一个现有的 Cloze 内部
    for (const match of doc.matchAll(clozeRegex)) {
        const clozeStart = match.indices && match.indices[0] ? match.indices[0][0] : null;
        const clozeEnd = match.indices && match.indices[0] ? match.indices[0][1] : null;
        
        // 确保indices 存在 
        if(clozeStart === null || clozeEnd === null) continue;

        // 如果选区完全包含在 Cloze 的内容部分，则解包这个 Cloze
        if (from >= clozeStart + 2 && to <= clozeEnd - 2) {
            const content = match[0].substring(2, match[0].length - 2);
            // 移除可能存在的 locator
            const plainContent = content.replace(/^(\s*\[[^\]]*\]\s*)?/, '');

            view.dispatch({
                changes: { from: clozeStart, to: clozeEnd, insert: plainContent },
                selection: { anchor: clozeStart, head: clozeStart + plainContent.length }
            });
            view.focus();
            return; // 操作完成，退出函数
        }
    }

    // 2. 如果不是在内部，则执行合并或创建逻辑
    let modificationStart = from;
    let modificationEnd = to;

    // 查找所有重叠或相邻的现有 Cloze，以确定最终的修改范围
    for (const match of doc.matchAll(clozeRegex)) {
         const clozeStart = match.indices && match.indices[0] ? match.indices[0][0] : null;
         const clozeEnd = match.indices && match.indices[0] ? match.indices[0][1] : null;

        if(clozeStart === null || clozeEnd === null) continue;

        // 检查重叠或紧邻（允许中间有空白字符）
        const isTouching = (
            (modificationStart >= clozeStart && modificationStart <= clozeEnd) ||
            (modificationEnd >= clozeStart && modificationEnd <= clozeEnd) ||
            (modificationStart <= clozeStart && modificationEnd >= clozeEnd) ||
            (doc.substring(clozeEnd, modificationStart).trim() === '' && clozeEnd <= modificationStart) ||
            (doc.substring(modificationEnd, clozeStart).trim() === '' && modificationEnd <= modificationStart)
        );

        if (isTouching) {
            modificationStart = Math.min(modificationStart, clozeStart);
            modificationEnd = Math.max(modificationEnd, clozeEnd);
        }
    }

    // 3. 获取需要包裹的最终内容，并移除内部的所有 Cloze 标记
    const contentToWrap = doc.slice(modificationStart, modificationEnd).replace(/--/g, '');
    
    // 如果处理后内容为空（例如，只选择了一个空的 Cloze），则不执行任何操作
    if (!contentToWrap.trim()) {
        view.focus();
        return;
    }
    
    // [NEW] 创建一个与参考代码类似的唯一 locator
    const locator = `c${Date.now()}`;
    const newText = `--[${locator}] ${contentToWrap.trim()}--`;

    view.dispatch({
        changes: { from: modificationStart, to: modificationEnd, insert: newText },
        selection: { anchor: modificationStart + 2, head: modificationStart + newText.length - 2 }
    });
    view.focus();
}

/**
 * [新增] 为选区添加带音频的 Cloze。
 * @param {import("@codemirror/view").EditorView} view
 */
export function applyAudioCloze(view) {
    const { from, to } = view.state.selection.main;
    if (from === to) {
        alert("请先选择要制作成 Cloze 的文本。");
        return;
    }
    
    const selectedText = view.state.doc.sliceString(from, to);
    const audioText = prompt("请输入音频提示文本:", selectedText);
    if (audioText === null) return; // 用户取消

    const newText = `--${selectedText}--^^audio:${audioText.trim()}^^`;
    
    view.dispatch({
        changes: { from, to, insert: newText }
    });
    view.focus();
}

/**
 * [新增] 插入一个换行符 (¶)。
 * @param {import("@codemirror/view").EditorView} view
 */
export function insertLinebreak(view) {
    const { from } = view.state.selection.main;
    view.dispatch({
        changes: { from, insert: "¶" }
    });
    view.focus();
}

// ======================================================
// ================ [NEW] 新增的命令函数 ================
// ======================================================

/**
 * 切换选定行的列表格式。
 * @param {import("@codemirror/view").EditorView} view
 * @param {string} prefix - 例如 "- ", "1. ", "> "
 */
function toggleLinePrefix(view, prefix) {
    const { from, to } = view.state.selection.main;
    const startLine = view.state.doc.lineAt(from);
    const endLine = view.state.doc.lineAt(to);
    
    let changes = [];
    let allLinesHavePrefix = true;
    
    // 检查是否所有行都已有前缀
    for (let i = startLine.number; i <= endLine.number; i++) {
        const line = view.state.doc.line(i);
        if (line.length > 0 && !line.text.startsWith(prefix)) {
            allLinesHavePrefix = false;
            break;
        }
    }

    // 根据检查结果添加或移除前缀
    for (let i = startLine.number; i <= endLine.number; i++) {
        const line = view.state.doc.line(i);
        if (allLinesHavePrefix) {
            // 移除前缀
            changes.push({ from: line.from, to: line.from + prefix.length, insert: '' });
        } else if (line.length > 0 && !line.text.startsWith(prefix)) {
            // 添加前缀
            changes.push({ from: line.from, insert: prefix });
        }
    }

    if (changes.length > 0) {
        view.dispatch({ changes });
    }
    view.focus();
}

/**
 * [NEW] 切换标题级别。每次点击在 H2, H3, 普通文本之间循环。
 * @param {import("@codemirror/view").EditorView} view
 */
export function toggleHeading(view) {
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const headingRegex = /^(#{2,3})\s/;
    const match = line.text.match(headingRegex);

    let change;
    if (match) {
        if (match[1] === '##') { // 从 H2 -> H3
            change = { from: line.from, to: line.from + 2, insert: '###' };
        } else { // 从 H3 -> 普通文本
            change = { from: line.from, to: line.from + 4, insert: '' };
        }
    } else { // 从普通文本 -> H2
        change = { from: line.from, insert: '## ' };
    }
    
    view.dispatch({ changes: [change] });
    view.focus();
}

/**
 * [NEW] 切换无序列表 (- item)。
 * @param {import("@codemirror/view").EditorView} view
 */
export function toggleUnorderedList(view) {
    toggleLinePrefix(view, '- ');
}

/**
 * [NEW] 切换有序列表 (1. item)。
 * @param {import("@codemirror/view").EditorView} view
 */
export function toggleOrderedList(view) {
    toggleLinePrefix(view, '1. ');
}

/**
 * [NEW] 切换任务列表 (- [ ] item)。
 * @param {import("@codemirror/view").EditorView} view
 */
export function toggleTaskList(view) {
    toggleLinePrefix(view, '- [ ] ');
}

/**
 * [NEW] 切换引用块 (> text)。
 * @param {import("@codemirror/view").EditorView} view
 */
export function toggleBlockquote(view) {
    toggleLinePrefix(view, '> ');
}

/**
 * [NEW & CORRECTED] 插入或包裹代码块。
 * @param {import("@codemirror/view").EditorView} view
 */
export function applyCodeBlock(view) {
    const { from, to } = view.state.selection.main;
    const selectedText = view.state.doc.sliceString(from, to);
    
    const lang = prompt("输入语言类型 (例如: js, python) 可留空:", "");
    const newText = `\`\`\`${lang || ''}\n${selectedText || '代码'}\n\`\`\``;

    view.dispatch({
        changes: { from, to, insert: newText },
        selection: { anchor: from + (lang ? lang.length : 0) + 4 }
    });
    view.focus();
}

/**
 * [NEW] 插入水平分割线。
 * @param {import("@codemirror/view").EditorView} view
 */
export function insertHorizontalRule(view) {
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    // 在当前行下方插入，如果当前行不为空，则加一个换行
    const insertPos = line.to;
    const insertText = (line.length > 0 ? '\n\n---\n' : '\n---\n');
    
    view.dispatch({
        changes: { from: insertPos, insert: insertText }
    });
    view.focus();
}

/**
 * [NEW] 插入一个基础表格模板。
 * @param {import("@codemirror/view").EditorView} view
 */
export function insertTable(view) {
    const { from } = view.state.selection.main;
    const tableTemplate = `
| 标题 1 | 标题 2 |
|---|---|
| 单元格 1 | 单元格 2 |
| 单元格 3 | 单元格 4 |
`;
    view.dispatch({
        changes: { from, insert: tableTemplate }
    });
    view.focus();
}

/**
 * [补全] 为选区添加或包裹 Markdown 链接。
 * 如果没有选区，则插入一个链接模板。
 * @param {import("@codemirror/view").EditorView} view
 */
export function applyLink(view) {
    const url = prompt("请输入链接 URL:", "https://");
    if (!url) return; // 用户取消或输入为空

    const { from, to } = view.state.selection.main;
    const selectedText = view.state.doc.sliceString(from, to);
    
    // 如果没有选择文本，使用 "链接文本" 作为占位符
    const linkText = selectedText || "链接文本";
    const newText = `[${linkText}](${url})`;

    view.dispatch({
        changes: { from, to, insert: newText },
        selection: { anchor: from + 1, head: from + 1 + linkText.length } // 选中链接文本部分
    });
    view.focus();
}


/**
 * [NEW] 插入图片 Markdown。
 * @param {import("@codemirror/view").EditorView} view
 */
export function insertImage(view) {
    const url = prompt("请输入图片 URL:", "https://");
    if (!url) return;
    const { from, to } = view.state.selection.main;
    const selectedText = view.state.doc.sliceString(from, to) || "图片描述";
    const newText = `![${selectedText}](${url})`;
    
    view.dispatch({
        changes: { from, to, insert: newText }
    });
    view.focus();
}
/**
 * [NEW] 触发 AI 回调。
 * 将当前选中的文本传递给回调函数。如果没有选中文本，则传递整个文档的内容。
 * @param {import("@codemirror/view").EditorView} view
 * @param {(text: string) => void} callback - 由宿主应用提供的 AI 处理函数。
 */
export function handleAIAction(view, callback) {
    if (typeof callback !== 'function') {
        console.warn("[MDxEditor] AI aCallback is not a function.");
        return;
    }
    const { from, to } = view.state.selection.main;
    const selectedText = view.state.doc.sliceString(from, to);
    
    const textToProcess = selectedText.length > 0 ? selectedText : view.state.doc.toString();
    
    callback(textToProcess);
    view.focus();
}

/**
 * [NEW] 触发保存回调。
 * 将整个文档的内容传递给回调函数。
 * @param {import("@codemirror/view").EditorView} view
 * @param {(text: string) => void} callback - 由宿主应用提供的保存处理函数。
 */
export function handleSaveAction(view, callback) {
    if (typeof callback !== 'function') {
        console.warn("[MDxEditor] Save callback is not a function.");
        return;
    }
    const fullText = view.state.doc.toString();
    callback(fullText);
    view.focus();
}

/**
 * [NEW] 触发浏览器打印功能。
 * @param {import("@codemirror/view").EditorView} view
 */
export async function handlePrintAction(editor) {
    // 1. 查找或创建打印容器
    let printContainer = document.getElementById('mdx-print-container');
    if (!printContainer) {
        printContainer = document.createElement('div');
        printContainer.id = 'mdx-print-container';
        // 确保它继承了渲染内容的样式类
        printContainer.className = 'rich-content-area'; 
        document.body.appendChild(printContainer);
    }
    
    // ======================================================
    // ================ [NEW] 模式判断逻辑 ================
    // ======================================================
    if (editor.mode === 'render') {
        // 2a. 在渲染模式下：直接复制当前所见内容
        console.log('Printing from render mode: Cloning current view.');
        printContainer.innerHTML = editor.renderEl.innerHTML;
    } else {
        // 2b. 在编辑模式下：重新渲染一份完整、展开的文档
        console.log('Printing from edit mode: Rendering a complete document.');
        const latestMarkdown = editor.getText();
        
        // 使用 renderer 渲染，并传入选项强制所有 cloze 可见，
        // 这为用户提供了最通用的“打印存档”体验。
        // 未来可以增加配置项，让用户选择打印“答案版”或“问题版”。
        const renderOptions = {
            areAllClozesVisible: true 
        };
        await editor._renderer.render(printContainer, latestMarkdown, renderOptions);
    }
    
    // 3. 添加临时 class 到 body 以激活打印样式
    document.body.classList.add('mdx-printing');
    
    // 4. 调用浏览器打印
    window.print();
    
    // 5. 打印对话框关闭后，进行清理
    document.body.classList.remove('mdx-printing');
    
    // 6. 清空打印容器，以防内容泄露或影响页面
    printContainer.innerHTML = '';

    // 确保焦点回到编辑器，提升体验
    if (editor.mode === 'edit') {
        editor.editorView.focus();
    }
}