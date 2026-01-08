/**
 * @file vfs-ui/utils/parser.ts
 * @desc Self-contained parsing utility for extracting metadata from file content.
 *       Now completely generic and agnostic of business logic (like Chat Manifests).
 */

import {
  tryParseJson,
  formatJsonSummary,
  parseMarkdown,
  type Heading,
} from '@itookit/common';

import type { FileMetadata } from '../types/types';

export interface ParseResult {
  summary: string;
  searchableText: string;
  headings: Heading[];
  metadata: FileMetadata;
}

// --- 主解析逻辑 ---

export function parseFileInfo(contentString: string | null | undefined): ParseResult {
  const defaultResult: ParseResult = {
    summary: '',
    searchableText: '',
    headings: [],
    metadata: {}
  };

  if (typeof contentString !== 'string' || !contentString) {
    return defaultResult;
  }

  // 1. JSON 处理
  const json = tryParseJson(contentString);
  if (json) {
    return {
      summary: formatJsonSummary(json),
      searchableText: contentString,
      headings: [],
      metadata: {},
    };
  }

  // 2. 委托给 Common Utils 进行全量解析
  const parsed = parseMarkdown(contentString, {
    extractHeadings: true,
    extractSummary: true,
    extractSearchable: true,
    extractTasks: true,
  });

  // 3. 数据适配 (Adapter)
  const metadata: FileMetadata = {};
  if (parsed.taskCounts) metadata.taskCount = parsed.taskCounts;
  if (parsed.clozeCount > 0) metadata.clozeCount = parsed.clozeCount;
  if (parsed.mermaidCount > 0) metadata.mermaidCount = parsed.mermaidCount;

  return {
    summary: parsed.summary || '',
    searchableText: parsed.searchableText,
    headings: parsed.headings, 
    metadata,
  };
}

// 导出辅助函数供其他 VFS 组件直接使用
export { extractTaskCounts } from '@itookit/common';
