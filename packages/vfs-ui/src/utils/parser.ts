/**
 * @file vfs-ui/utils/parser.ts
 * @desc Self-contained parsing utility for extracting metadata from file content.
 *       Now completely generic and agnostic of business logic (like Chat Manifests).
 */

import { slugify } from '@itookit/common';
import type { Heading, FileMetadata } from '../types/types.js';

/**
 * The result structure returned by the parseFileInfo function.
 */
export interface ParseResult {
    summary: string;
    searchableText: string;
    headings: Heading[];
    metadata: FileMetadata;
}

/**
 * 专门用于提取任务统计的辅助函数
 * 支持 Markdown 标准语法 (- [ ])、表格内语法以及 HTML 语法
 */
export const extractTaskCounts = (content: string): { total: number; completed: number } => {
    let total = 0, completed = 0;

    // Markdown checkboxes
    const mdMatches = [...content.matchAll(/(?:^|[\s|])(?:[-+*]|\d+\.)?\s*\[([ xX])\]/g)];
    total += mdMatches.length;
    completed += mdMatches.filter(m => m[1].toLowerCase() === 'x').length;

    // HTML checkboxes
    const htmlMatches = [...content.matchAll(/<input[^>]+type=["']checkbox["'][^>]*>/gi)];
    total += htmlMatches.length;
    completed += htmlMatches.filter(m => /checked/i.test(m[0])).length;

    return { total, completed };
};

// [优化] 通用 JSON 格式化：扁平化显示
const formatGenericJson = (json: any): string => {
    if (Array.isArray(json)) return `[List: ${json.length} items]`;
    if (typeof json !== 'object' || json === null) return String(json);

    const priorityKeys = ['title', 'name', 'description', 'desc', 'summary', 'type', 'id', 'status'];
    const keys = Object.keys(json).sort((a, b) => {
        const [idxA, idxB] = [priorityKeys.indexOf(a), priorityKeys.indexOf(b)];
        if (idxA > -1 && idxB > -1) return idxA - idxB;
        if (idxA > -1) return -1;
        if (idxB > -1) return 1;
        return a.localeCompare(b);
    });

    const parts: string[] = [];
    for (const key of keys) {
        if (parts.length >= 4) break;
        const val = json[key];
        if (typeof val === 'string') {
            parts.push(`${key}: ${val.length > 30 ? val.substring(0, 30) + '...' : val}`);
        } else if (typeof val === 'number' || typeof val === 'boolean') {
            parts.push(`${key}: ${val}`);
        } else if (Array.isArray(val)) {
            parts.push(`${key}: [${val.length}]`);
        } else if (val === null) {
            parts.push(`${key}: null`);
        }
    }

    return parts.length ? parts.join(' | ') : '{ ... }';
};

/**
 * 尝试解析 JSON 字符串
 */
const tryParseJson = (text: string): any | null => {
    const trimmed = text.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try { return JSON.parse(text); } catch { return null; }
    }
    return null;
};

export const parseFileInfo = (contentString: string | null | undefined): ParseResult => {
    const defaultResult: ParseResult = { summary: '', searchableText: '', headings: [], metadata: {} };
    
    if (typeof contentString !== 'string' || !contentString) return defaultResult;

    // Try JSON first
    const json = tryParseJson(contentString);
    if (json) {
        return { summary: formatGenericJson(json), searchableText: contentString, headings: [], metadata: {} };
    }

    // Markdown parsing
    const lines = contentString.split('\n');
    let summary = '';
    const headings: Heading[] = [];
    let currentH1: (Heading & { children: Heading[] }) | null = null;

    for (const line of lines) {
        const trimmed = line.trim();
        const h1Match = trimmed.match(/^#\s+(.*)/);
        const h2Match = trimmed.match(/^##\s+(.*)/);

        if (h1Match) {
            const text = h1Match[1].trim();
            currentH1 = { level: 1, text, elementId: `heading-${slugify(text)}`, children: [] };
            headings.push(currentH1);
        } else if (h2Match) {
            const text = h2Match[1].trim();
            const h2: Heading = { level: 2, text, elementId: `heading-${slugify(text)}`, children: [] };
            currentH1 ? currentH1.children.push(h2) : headings.push({ ...h2, level: 1, children: [] });
        } else if (!summary && trimmed && !trimmed.startsWith('---') && !trimmed.startsWith('```') && !trimmed.startsWith('#')) {
            summary = trimmed;
        }
    }

    // Clean summary
    summary = summary.replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/[*_~`]/g, '');
    summary = summary.length > 120 ? summary.substring(0, 120) + '…' : summary;

    // Searchable text
    const searchableText = contentString
        .replace(/^#+\s/gm, '')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]+`/g, '')
        .replace(/([*_~>#\-+|])/g, '')
        .trim();

    // Metadata
    const metadata: FileMetadata = {};
    const taskStats = extractTaskCounts(contentString);
    if (taskStats.total > 0) metadata.taskCount = taskStats;

    const clozes = contentString.match(/--/g);
    if (clozes?.length) metadata.clozeCount = Math.floor(clozes.length / 2);

    const mermaids = contentString.match(/```mermaid/g);
    if (mermaids?.length) metadata.mermaidCount = mermaids.length;

    return { summary, searchableText, headings, metadata };
};
