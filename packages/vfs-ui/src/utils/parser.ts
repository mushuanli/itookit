/**
 * @file vfs-ui/utils/parser.ts
 * @desc Self-contained parsing utility for extracting metadata from file content.
 *       Now completely generic and agnostic of business logic (like Chat Manifests).
 */

import { slugify } from '@itookit/common';
import type { Heading, FileMetadata, ParseResult } from '../types/types';

/**
 * 专门用于提取任务统计的辅助函数
 * 支持 Markdown 标准语法 (- [ ])、表格内语法以及 HTML 语法
 */
export const extractTaskCounts = (content: string): { total: number; completed: number } => {
  const mdMatches = [...content.matchAll(/(?:^|[\s|])(?:[-+*]|\d+\.)?\s*\[([ xX])\]/g)];
  const htmlMatches = [...content.matchAll(/<input[^>]+type=["']checkbox["'][^>]*>/gi)];
  
  return {
    total: mdMatches.length + htmlMatches.length,
    completed: mdMatches.filter(m => m[1].toLowerCase() === 'x').length +
               htmlMatches.filter(m => /checked/i.test(m[0])).length
  };
};

// [优化] 通用 JSON 格式化：扁平化显示
const formatGenericJson = (json: any): string => {
  if (Array.isArray(json)) return `[List: ${json.length} items]`;
  if (typeof json !== 'object' || json === null) return String(json);

  const priorityKeys = ['title', 'name', 'description', 'desc', 'summary', 'type', 'id', 'status'];
  const keys = Object.keys(json).sort((a, b) => {
    const [iA, iB] = [priorityKeys.indexOf(a), priorityKeys.indexOf(b)];
    return iA > -1 && iB > -1 ? iA - iB : iA > -1 ? -1 : iB > -1 ? 1 : a.localeCompare(b);
  });

  return keys.slice(0, 4).map(key => {
    const val = json[key];
    if (typeof val === 'string') return `${key}: ${val.length > 30 ? val.slice(0, 30) + '...' : val}`;
    if (typeof val === 'number' || typeof val === 'boolean' || val === null) return `${key}: ${val}`;
    if (Array.isArray(val)) return `${key}: [${val.length}]`;
    return null;
  }).filter(Boolean).join(' | ') || '{ ... }';
};

/**
 * 尝试解析 JSON 字符串
 */
const tryParseJson = (text: string): any | null => {
  const t = text.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { return JSON.parse(text); } catch { return null; }
  }
  return null;
};

export const parseFileInfo = (content: string | null | undefined): ParseResult => {
  const defaultResult: ParseResult = { summary: '', searchableText: '', headings: [], metadata: {} };
  if (typeof content !== 'string' || !content) return defaultResult;

  const json = tryParseJson(content);
  if (json) return { ...defaultResult, summary: formatGenericJson(json), searchableText: content };

  const lines = content.split('\n');
  let summary = '';
  const headings: Heading[] = [];
  let currentH1: (Heading & { children: Heading[] }) | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const h1 = trimmed.match(/^#\s+(.*)/);
    const h2 = trimmed.match(/^##\s+(.*)/);

    if (h1) {
      const text = h1[1].trim();
      currentH1 = { level: 1, text, elementId: `heading-${slugify(text)}`, children: [] };
      headings.push(currentH1);
    } else if (h2) {
      const text = h2[1].trim();
      const h2Item: Heading = { level: 2, text, elementId: `heading-${slugify(text)}`, children: [] };
      currentH1 ? currentH1.children.push(h2Item) : headings.push({ ...h2Item, level: 1 });
    } else if (!summary && trimmed && !/^(---|```|#)/.test(trimmed)) {
      summary = trimmed;
    }
  }

  summary = summary.replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/[*_~`]/g, '');
  if (summary.length > 120) summary = summary.slice(0, 120) + '…';

  const searchableText = content
    .replace(/^#+\s/gm, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/([*_~>#\-+|])/g, '')
    .trim();

  const metadata: FileMetadata = {};
  const taskStats = extractTaskCounts(content);
  if (taskStats.total > 0) metadata.taskCount = taskStats;

  const clozes = content.match(/--/g);
  if (clozes?.length) metadata.clozeCount = Math.floor(clozes.length / 2);

  const mermaids = content.match(/```mermaid/g);
  if (mermaids?.length) metadata.mermaidCount = mermaids.length;

  return { summary, searchableText, headings, metadata };
};
