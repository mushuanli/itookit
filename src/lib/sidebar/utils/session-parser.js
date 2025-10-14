// #sidebar/utils/session-parser.js
// [新增] 这是一个符合新架构的、自包含的解析工具模块。

import { slugify } from '../../common/utils/utils.js';


/**
 * @typedef {import('../types/types.js')._Heading} Heading
 * @typedef {import('../types/types.js')._SessionMetadata} SessionMetadata
 */

/**
 * 从会话内容字符串中提取摘要等信息。
 * [修改] 此函数现在能智能处理两种格式：
 * 1. ChatUI 生成的特定JSON格式。
 * 2. 传统的Markdown文本格式。
 * @param {string | null | undefined} contentString
 * @returns {{ summary: string, searchableText: string, headings: Heading[], metadata: SessionMetadata }}
 */
export function parseSessionInfo(contentString) {
    // [改进] 增加健壮性检查
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
                headings.push({ ...h2, children: [] });
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

    // Extract metadata
    const metadata = {};
    const tasks = contentString.match(/-\s\[\s*[xX]?\s*\]/g) || [];
    if (tasks.length > 0) {
        metadata.taskCount = {
            total: tasks.length,
            completed: tasks.filter(t => /-\s\[\s*[xX]\s*\]/.test(t)).length
        };
    }
    const clozes = contentString.match(/--/g) || [];
    metadata.clozeCount = Math.floor(clozes.length / 2);
    const mermaids = contentString.match(/```mermaid/g) || [];
    metadata.mermaidCount = mermaids.length;

    return { summary, searchableText, headings, metadata };
}