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

  // 匹配 HTML 复选框: <input type="checkbox">
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

// [优化] 通用 JSON 格式化：扁平化显示
function formatGenericJson(json: any): string {
    if (Array.isArray(json)) {
        return `[List: ${json.length} items]`;
    }
    
    if (typeof json === 'object' && json !== null) {
        // 提取前 3-4 个主要字段，忽略复杂对象
        const keys = Object.keys(json);
        const parts: string[] = [];
        
        // 定义优先显示的字段，提高摘要的可读性
        const priorityKeys = ['title', 'name', 'description', 'desc', 'summary', 'type', 'id', 'status'];
        
        // 简单的排序：优先字段在前，其他字段按字母序
        const sortedKeys = keys.sort((a, b) => {
            const idxA = priorityKeys.indexOf(a);
            const idxB = priorityKeys.indexOf(b);
            if (idxA > -1 && idxB > -1) return idxA - idxB;
            if (idxA > -1) return -1;
            if (idxB > -1) return 1;
            return a.localeCompare(b);
        });

        for (const key of sortedKeys) {
            if (parts.length >= 4) break; // 限制显示的字段数量，防止过长
            
            const val = json[key];
            
            // 只显示基本类型的值，对象和数组显示简略信息
            if (typeof val === 'string') {
                // 截断过长的字符串值
                const cleanVal = val.length > 30 ? val.substring(0, 30) + '...' : val;
                parts.push(`${key}: ${cleanVal}`);
            } else if (typeof val === 'number' || typeof val === 'boolean') {
                parts.push(`${key}: ${val}`);
            } else if (Array.isArray(val)) {
                parts.push(`${key}: [${val.length}]`);
            } else if (val === null) {
                parts.push(`${key}: null`);
            }
        }
        
        if (parts.length === 0) {
            return '{ ... }'; // 空对象或全是复杂对象
        }
        
        return parts.join(' | '); // 使用竖线分隔，视觉上更整洁
    }
    
    return String(json);
}

/**
 * 尝试解析 JSON 字符串
 */
function tryParseJson(text: string): any | null {
    const trimmed = text.trim();
    // 快速检查首尾字符，避免对明显不是 JSON 的文本进行 parse
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
 * This is the default parser used when no custom contentParser is provided via registry.
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

  // 1. 优先尝试作为通用 JSON 处理
  // 如果是 JSON，使用扁平化格式化器生成摘要
  const json = tryParseJson(contentString);
  if (json) {
      return {
          summary: formatGenericJson(json),
          searchableText: contentString, // 允许搜索原始 JSON 文本
          headings: [], // JSON 文件通常没有大纲
          metadata: {}  // 默认不提取 JSON 内部字段到 metadata，除非使用自定义解析器
      };
  }

  // 2. Fallback: 标准 Markdown 解析逻辑
  const lines = contentString.split('\n');
  let summary = '';
  const headings: Heading[] = [];
  
  // 用于构建大纲树结构
  let currentH1: (Heading & { children: Heading[] }) | null = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 简单的正则匹配 H1 和 H2
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
        // 如果没有 H1 父级，H2 提升为顶层节点显示
        headings.push({ ...h2, level: 1, children: [] });
      }
    } else if (!summary && trimmedLine.length > 0 && 
               !trimmedLine.startsWith('---') && // 忽略 Frontmatter 分隔符
               !trimmedLine.startsWith('```') && // 忽略代码块
               !trimmedLine.startsWith('#')) {   // 忽略标题
      // 提取第一段非空文本作为摘要
      summary = trimmedLine;
    }
  }
  
  // 清理摘要中的 Markdown 标记 (如链接、加粗)
  summary = summary.replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/[*_~`]/g, '');
  // 截断过长摘要
  summary = summary.length > 120 ? summary.substring(0, 120) + '…' : summary;

  // 生成纯文本用于搜索 (移除 Markdown 符号)
  const searchableText = contentString
    .replace(/^#+\s/gm, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/(\*|_|~|>|#|-|\+|\|)/g, '')
    .trim();

  const metadata: FileMetadata = {};

  // 提取任务统计
  const taskStats = extractTaskCounts(contentString);
  if (taskStats.total > 0) {
      metadata.taskCount = taskStats;
  }
  
  // 提取填空数量 (--)
  const clozes = contentString.match(/--/g) || [];
  if (clozes.length > 0) {
    metadata.clozeCount = Math.floor(clozes.length / 2);
  }

  // 提取 Mermaid 图表数量
  const mermaids = contentString.match(/```mermaid/g) || [];
  if (mermaids.length > 0) {
    metadata.mermaidCount = mermaids.length;
  }

  return { summary, searchableText, headings, metadata };
}
