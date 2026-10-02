import type { Heading } from '../editor/contracts';
interface ParsedMarkdownContent { linesOutsideCode: string[]; textOutsideCode: string; allLines: string[]; }

export function slugify(text: string): string {
    if (typeof text !== 'string')
        return '';
    return text
        .toLowerCase()
        .trim()
        .replace(/[\s\-_]+/g, '-')
        .replace(/[^\w\u4e00-\u9fa5-]/g, '')
        .replace(/^-+|-+$/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function tryParseJson(text: string): unknown | null {
    if (!text)
        return null;
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return null;
    }
    if ((trimmed.startsWith('{') && !trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && !trimmed.endsWith(']'))) {
        return null;
    }
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return null;
    }
}

export function parseMarkdownContent(content: string): ParsedMarkdownContent {
    const allLines = content.split('\n'), linesOutsideCode: string[] = [];
    let marker = '', markerLength = 0;
    for (const line of allLines) {
        const fence = line.match(/^(`{3,}|~{3,})/);
        if (fence) {
            if (!marker) { marker = fence[1][0]; markerLength = fence[1].length; }
            else if (fence[1][0] === marker && fence[1].length >= markerLength && line.trim() === fence[1]) {
                marker = ''; markerLength = 0;
            }
        } else if (!marker) linesOutsideCode.push(line);
    }
    return { allLines, linesOutsideCode, textOutsideCode: linesOutsideCode.join('\n').replace(/`[^`\n]+`/g, '') };
}

function appendHeading(headings: Heading[], stack: Heading[], heading: Heading): void {
    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(heading);
    else headings.push(heading);
    stack.push(heading);
}

export function extractHeadings(content: string, options: { nested?: boolean } = {}): Heading[] {
    const headings: Heading[] = [], stack: Heading[] = [];
    const slugCount = new Map<string, number>();
    for (const line of parseMarkdownContent(content).linesOutsideCode) {
        const match = line.match(/^(#{1,6})\s+(.+)/);
        if (!match || !match[2].trim()) continue;
        const text = match[2].trim(), level = match[1].length;
        const baseSlug = `heading-${slugify(text)}`, count = slugCount.get(baseSlug) ?? 0;
        slugCount.set(baseSlug, count + 1);
        const heading = { level, text, id: count ? `${baseSlug}-${count}` : baseSlug, children: [] };
        if (options.nested) appendHeading(headings, stack, heading);
        else headings.push(heading);
    }
    return headings;
}

function jsonSummary(obj: Record<string, unknown>): string | null {
    if (typeof obj.description === 'string') return obj.description;
    if (typeof obj.summary === 'string') return obj.summary;
    const pair = Array.isArray(obj.pairs) ? obj.pairs[0] : undefined;
    return isRecord(pair) && typeof pair.human === 'string' ? pair.human : null;
}

export function extractSummary(content: string, maxLength: number = 150): string | null {
    const json = tryParseJson(content);
    if (isRecord(json)) return jsonSummary(json);
    const { linesOutsideCode } = parseMarkdownContent(content);
    for (const line of linesOutsideCode) {
        const trimmed = line.trim();
        if (!trimmed || /^#{1,6}\s/.test(trimmed) || /^[-*_]{3,}$/.test(trimmed)) continue;
        const cleaned = trimmed
            .replace(/\[(.*?)\]\(.*?\)/g, '$1')
            .replace(/!\[.*?\]\(.*?\)/g, '')
            .replace(/[*_~`]/g, '')
            .trim();
        if (cleaned) {
            return cleaned.length > maxLength
                ? cleaned.substring(0, maxLength) + '…'
                : cleaned;
        }
    }
    return null;
}

function jsonSearchableText(obj: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const key of ['name', 'title', 'description', 'summary']) {
        if (typeof obj[key] === 'string') parts.push(obj[key]);
    }
    if (Array.isArray(obj.pairs)) for (const pair of obj.pairs) {
        if (!isRecord(pair)) continue;
        if (typeof pair.human === 'string') parts.push(pair.human);
        if (typeof pair.ai === 'string') parts.push(pair.ai);
    }
    return parts.join('\n');
}

export function extractSearchableText(content: string): string {
    const json = tryParseJson(content);
    if (isRecord(json)) return jsonSearchableText(json);
    const { linesOutsideCode } = parseMarkdownContent(content);
    return linesOutsideCode
        .join('\n')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/!\[.*?\]\(.*?\)/g, '')
        .replace(/`[^`\n]+`/g, '')
        .replace(/[*_~]+/g, '')
        .replace(/^\s*[-+*]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .replace(/^\s*>\s+/gm, '')
        .replace(/\|/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export type { Heading } from '../editor/contracts';
