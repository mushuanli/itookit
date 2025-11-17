/**
 * @file vfs-ui/src/utils/parser.ts
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

  // 1. Attempt to parse as Chat JSON first.
  try {
    const data = JSON.parse(contentString);
    if (data && typeof data === 'object' && Array.isArray(data.pairs)) {
      const summary = (data.description || '').substring(0, 120) + (data.description?.length > 120 ? '…' : '');
      
      const searchableText = data.pairs
        .map((p: { human?: string, ai?: string }) => `${p.human || ''}\n${p.ai || ''}`)
        .join('\n');
            
      return {
        summary,
        searchableText,
        headings: [], // Chat JSON does not have markdown headings
        metadata: {},
      };
    }
  } catch (e) {
    // Not valid JSON, fall through to parse as Markdown.
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
      currentH1 = {
        level: 1,
        text,
        elementId: `heading-${slugify(text)}`,
        children: [],
      };
      headings.push(currentH1);
    } else if (h2Match) {
      const text = h2Match[1].trim();
      const h2: Heading = {
        level: 2,
        text,
        elementId: `heading-${slugify(text)}`,
      };
      if (currentH1) {
        currentH1.children.push(h2);
      } else {
        // If an H2 appears before any H1, treat it as a top-level heading
        headings.push({ ...h2, level: 1, children: [] });
      }
    } else if (!summary && trimmedLine.length > 0 && !trimmedLine.startsWith('---') && !trimmedLine.startsWith('```')) {
      summary = trimmedLine;
    }
  }
  
  // Format summary
  summary = summary.replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/[*_~`]/g, '');
  summary = summary.length > 120 ? summary.substring(0, 120) + '…' : summary;

  // Generate searchableText from Markdown by stripping syntax
  const searchableText = contentString
    .replace(/^#+\s/gm, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/(\*|_|~|>|#|-|\+)/g, '')
    .trim();

  // Extract structured metadata from content
  const metadata: FileMetadata = {};
  const tasks = contentString.match(/-\s\[\s*[xX]?\s*\]/g) || [];
  if (tasks.length > 0) {
    metadata.taskCount = {
      total: tasks.length,
      completed: tasks.filter(t => /-\s\[\s*[xX]\s*\]/.test(t)).length,
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
