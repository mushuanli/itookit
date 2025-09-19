// src/anki/services/renderService.js

// 导入依赖
import { generateId,slugify } from '../../common/utils.js';

// --- Helper Functions ---


/**
 * [NEW] 解析Markdown内容中的标题结构
 * @param {string} content - Markdown内容
 * @returns {Array} 结构化的标题数组
 */
export function parseAndStructureHeadings(content) {
    const headingRegex = /^(#{1,2})\s+(.+)$/gm;
    const structuredHeadings = [];
    let lastH1 = null;
    let match;

    while ((match = headingRegex.exec(content)) !== null) {
        const level = match[1].length;
        const text = match[2].trim();
        const heading = {
            id: generateId(),
            text,
            level,
            children: level === 1 ? [] : undefined
        };

        if (level === 1) {
            structuredHeadings.push(heading);
            lastH1 = heading;
        } else if (level === 2 && lastH1) {
            lastH1.children.push(heading);
        }
    }
    return structuredHeadings;
}

// 注意：旧的 renderMarkdown, processCloze, processTaskLists, renderMathAndMermaid 函数已被移除，
// 因为它们的功能已全部整合到 /src/common/RichContentRenderer.js 中。