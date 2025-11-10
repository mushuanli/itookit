// #sidebar/utils/session-parser.js
// [新增] 这是一个符合新架构的、自包含的解析工具模块。

import { slugify } from '@itookit/common';


/**
 * @typedef {import('../types/types.js')._Heading} Heading
 * @typedef {import('../types/types.js')._FileMetadata} FileMetadata
 */

/**
 * Extracts summary, headings, and other metadata from a file's content string.
 * This function can intelligently handle different formats, such as Chat JSON or standard Markdown.
 * 
 * @param {string | null | undefined} contentString
 * @returns {{ summary: string, searchableText: string, headings: Heading[], metadata: FileMetadata }}
 */
export function parseFileInfo(contentString) {
    // Robustness check
    if (typeof contentString !== 'string' || !contentString) {
        return { summary: '', searchableText: '', headings: [], metadata: {} };
    }

    // --- [核心修改] ---
    // 1. 优先尝试按JSON格式解析
    try {
        const data = JSON.parse(contentString);
        if (data && typeof data === 'object' && Array.isArray(data.pairs)) {
            const summary = (data.description || '').substring(0, 120) + (data.description && data.description.length > 120 ? '…' : '');
            
            // Generate searchableText by concatenating all conversational content
            const searchableText = data.pairs
                .map(p => `${p.human || ''}\n${p.ai || ''}`)
                .join('\n');
                
            return {
                summary,
                searchableText,
                headings: [], // Chat JSON does not have markdown headings
                metadata: {}
            };
        }
    } catch (e) {
        // 如果解析JSON失败，说明它可能是Markdown，程序将继续执行下面的逻辑。
        // 这是我们的回退(fallback)机制，确保了向后兼容性。
    }

    // --- 2. 如果不是有效的JSON，则按原有的Markdown格式解析 ---
    const lines = contentString.split('\n');
    let summary = '';
    const headings = [];
    let currentH1 = null;

    // --- 1. 提取摘要和标题 ---
    for (const line of lines) {
        const trimmedLine = line.trim();

        // 提取标题 (H1)
        if (trimmedLine.startsWith('# ')) {
            const text = trimmedLine.substring(2).trim();
            // [关键] 使用内部的 slugify
            const elementId = `heading-${slugify(text)}`;
            currentH1 = { level: 1, text, elementId, children: [] };
            headings.push(currentH1);
        } else if (trimmedLine.startsWith('## ')) {
            const text = trimmedLine.substring(3).trim();
            // [关键] 使用内部的 slugify
            const elementId = `heading-${slugify(text)}`;
            const h2 = { level: 2, text, elementId };
            if (currentH1) {
                currentH1.children.push(h2);
            } else {
                // Treat as a top-level heading if no H1 is present
                headings.push({ ...h2, level: 1, children: [] });
            }
        } else if (!summary && trimmedLine.length > 0 && !trimmedLine.startsWith('---') && !trimmedLine.startsWith('```')) {
            summary = trimmedLine;
        }
    }
    
    // Format summary
    summary = summary.replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/[*_~`]/g, '');
    summary = summary.length > 120 ? summary.substring(0, 120) + '…' : summary;

    // [NEW] Generate searchableText from Markdown by stripping syntax
    const searchableText = contentString
        .replace(/^#+\s/gm, '') // Headings
        .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Links
        .replace(/```[\s\S]*?```/g, '') // Code blocks
        .replace(/`[^`]+`/g, '') // Inline code
        .replace(/(\*|_|~|>|#|-|\+)/g, '') // Other markdown characters
        .trim();

    // Extract structured metadata from content
    /** @type {FileMetadata} */
    const metadata = {};
    const tasks = contentString.match(/-\s\[\s*[xX]?\s*\]/g) || [];
    if (tasks.length > 0) {
        metadata.taskCount = {
            total: tasks.length,
            completed: tasks.filter(t => /-\s\[\s*[xX]\s*\]/.test(t)).length
        };
    }
    const clozes = contentString.match(/--/g) || [];
    if (clozes.length > 0) {
        metadata.clozeCount = Math.floor(clozes.length / 2);
    }
    const mermaids = contentString.match(/```mermaid/g) || [];
    if (mermaids.length > 0) {
        metadata.mermaidCount = mermaids.length;
    }

    return { summary, searchableText, headings, metadata };
}