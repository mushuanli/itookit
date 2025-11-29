/**
 * @file vfs-ui/utils/parser.ts
 * @desc Self-contained parsing utility for extracting metadata from file content.
 */

import { slugify } from '@itookit/common';
import type { Heading, FileMetadata } from '../types/types.js';

/**
 * The result structure returned by the parseFileInfo function.
 */
interface ParseResult {
  summary: string;
  searchableText: string;
  headings: Heading[];
  metadata: FileMetadata;
}

/**
 * 专门用于提取任务统计的辅助函数
 * 支持 Markdown 标准语法、表格内语法以及 HTML 语法
 */
export function extractTaskCounts(content: string): { total: number; completed: number } {
  let total = 0;
  let completed = 0;

  // [修复] 增强的正则
  // 解释：
  // (?:^|[\s|])       -> 前面必须是：行首、空白字符、或者表格管道符 |
  // (?:[-+*]|\d+\.)?  -> 可选的列表标记 (- + * 1.)
  // \s*               -> 可选的空格
  // \[([ xX])\]       -> 核心匹配 [ ] [x] [X]
  const mdRegex = /(?:^|[\s|])(?:[-+*]|\d+\.)?\s*\[([ xX])\]/g;
  
  const mdMatches = [...content.matchAll(mdRegex)];
  total += mdMatches.length;
  completed += mdMatches.filter(m => m[1].toLowerCase() === 'x').length;

  // HTML 语法匹配
  const htmlRegex = /<input[^>]+type=["']checkbox["'][^>]*>/gi;
  const htmlMatches = [...content.matchAll(htmlRegex)];
  
  total += htmlMatches.length;
  htmlMatches.forEach(m => {
      if (/checked/i.test(m[0])) completed++;
  });

  // [DEBUG] 仅在有数据时输出，减少刷屏
  if (total > 0) {
      console.log(`[Parser] Found tasks: ${completed}/${total}`);
  }

  return { total, completed };
}

// [新增] 尝试解析 JSON
function tryParseJson(text: string): any | null {
    const trimmed = text.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    }
    return null;
}

/**
 * Extracts summary, headings, and other metadata from a file's content string.
 * This function intelligently handles different formats, such as Chat JSON or standard Markdown.
 *
 * @param contentString - The raw content of a file.
 * @returns A structured object containing the parsed information.
 */
export function parseFileInfo(contentString: string | null | undefined): ParseResult {
  const defaultResult: ParseResult = {
    summary: '',
    searchableText: '',
    headings: [],
    metadata: {},
  };

  if (typeof contentString !== 'string' || !contentString) {
    return defaultResult;
  }

  // 1. [修改] 优先尝试解析为 JSON
  const json = tryParseJson(contentString);
  if (json) {
      // 提取摘要策略
      let summary = '';
      
      // 策略 A: 优先查找描述性字段
      if (typeof json.description === 'string') summary = json.description;
      else if (typeof json.desc === 'string') summary = json.desc; // 增加 desc
      else if (typeof json.summary === 'string') summary = json.summary;
      
      // 策略 B: Chat History 特殊处理
      else if (Array.isArray(json.pairs) && json.pairs.length > 0) {
          summary = json.pairs[0].human || '';
      }
      
      // 策略 C: 实在没有描述，尝试使用 name
      else if (typeof json.name === 'string') {
          summary = json.name;
      }

      // 策略 D (兜底): 如果上面都没找到，截取部分 JSON 文本作为摘要
      // 去掉换行符，让其在一行内显示紧凑点
      if (!summary) {
          summary = contentString.replace(/\s+/g, ' ').substring(0, 100);
      }

      return {
          summary: summary.substring(0, 150),
          searchableText: contentString, // 搜索还是搜全文比较好
          headings: [], // JSON 不支持大纲解析
          metadata: {} // 暂不提取复杂元数据
      };
  }

  // 2. Fallback to parsing as standard Markdown.
  const lines = contentString.split('\n');
  let summary = '';
  const headings: Heading[] = [];
  // Correctly type currentH1 to hold a complete Heading object with children
  let currentH1: (Heading & { children: Heading[] }) | null = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    const h1Match = trimmedLine.match(/^#\s+(.*)/);
    const h2Match = trimmedLine.match(/^##\s+(.*)/);

    if (h1Match) {
      const text = h1Match[1].trim();
      const elementId = `heading-${slugify(text)}`;
      currentH1 = { level: 1, text, elementId, children: [] };
      headings.push(currentH1);
    } else if (h2Match) {
      const text = h2Match[1].trim();
      const elementId = `heading-${slugify(text)}`;
      const h2: Heading = { level: 2, text, elementId, children: [] };
      if (currentH1) {
        currentH1.children.push(h2);
      } else {
        headings.push({ ...h2, level: 1, children: [] });
      }
    } else if (!summary && trimmedLine.length > 0 && !trimmedLine.startsWith('---') && !trimmedLine.startsWith('```') && !trimmedLine.startsWith('#')) {
      summary = trimmedLine;
    }
  }
  
  summary = summary.replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/[*_~`]/g, '');
  summary = summary.length > 120 ? summary.substring(0, 120) + '…' : summary;

  const searchableText = contentString
    .replace(/^#+\s/gm, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/(\*|_|~|>|#|-|\+|\|)/g, '')
    .trim();

  const metadata: FileMetadata = {};

  // [修复] 任务统计
  const taskStats = extractTaskCounts(contentString);
  if (taskStats.total > 0) {
      metadata.taskCount = taskStats;
      // 🔥 [DEBUG] 确认 metadata 被赋值
      //console.log('[Parser] Metadata updated with tasks:', metadata.taskCount);
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
