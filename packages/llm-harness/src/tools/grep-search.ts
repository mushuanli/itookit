// @file: llm-harness/src/tools/grep-search.ts
// 内容搜索工具（正则，path:行号 格式输出）。

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ToolMeta, ToolDefinition, ToolHandler } from '@itookit/common';

export const grepSearchMeta: ToolMeta = {
    id: 'grep_search',
    name: 'Grep Search',
    description: 'Search file contents using regular expressions',
    sideEffect: 'none',
    timeoutMs: 30_000,
    type: 'builtin',
    enabled: true,
    tags: ['file', 'search', 'grep'],
};

export const grepSearchDefinition: ToolDefinition = {
    name: 'grep_search',
    description:
        'Search for a regex pattern in file contents. ' +
        'Returns matches in "path:line:content" format. ' +
        'Supports file glob filtering. Skips binary files automatically.',
    parameters: {
        type: 'object',
        properties: {
            pattern: {
                type: 'string',
                description: 'Regular expression pattern to search for',
            },
            glob: {
                type: 'string',
                description: 'File glob filter (e.g. "*.ts", "**/*.tsx"). Defaults to all text files.',
            },
            base_dir: {
                type: 'string',
                description: 'Base directory for the search (default: working directory)',
            },
            case_insensitive: {
                type: 'boolean',
                description: 'Case-insensitive matching (default: false)',
            },
            context_lines: {
                type: 'number',
                description: 'Number of context lines before/after each match (default: 0)',
            },
            limit: {
                type: 'number',
                description: 'Maximum number of matches to return (default: 50)',
            },
        },
        required: ['pattern'],
    },
};

const IGNORED_DIRS = new Set([
    'node_modules', 'dist', '.git', '.svn', 'build', 'out',
    '.next', '.nuxt', '.cache', 'coverage', '__pycache__',
]);

function globToRegex(pattern: string): RegExp {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '§GLOBSTAR§')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/§GLOBSTAR§/g, '.*');
    return new RegExp(`^${escaped}$`);
}

function isBinary(buf: Buffer): boolean {
    for (let i = 0; i < Math.min(buf.length, 512); i++) {
        const b = buf[i];
        if (b === 0 || (b < 7 && b !== 0)) return true;
    }
    return false;
}

interface Match { file: string; line: number; content: string }

async function searchFile(
    filePath: string,
    relPath: string,
    regex: RegExp,
    contextLines: number,
    matches: Match[],
    limit: number,
): Promise<void> {
    if (matches.length >= limit) return;

    const buf = await readFile(filePath).catch(() => null);
    if (!buf || isBinary(buf)) return;

    const lines = buf.toString('utf-8').split('\n');
    for (let i = 0; i < lines.length && matches.length < limit; i++) {
        if (!regex.test(lines[i])) continue;

        if (contextLines === 0) {
            matches.push({ file: relPath, line: i + 1, content: lines[i] });
        } else {
            const start = Math.max(0, i - contextLines);
            const end = Math.min(lines.length - 1, i + contextLines);
            for (let j = start; j <= end && matches.length < limit; j++) {
                matches.push({ file: relPath, line: j + 1, content: lines[j] });
            }
        }
    }
}

async function walkAndSearch(
    dir: string,
    baseDir: string,
    fileRegex: RegExp | null,
    contentRegex: RegExp,
    contextLines: number,
    matches: Match[],
    limit: number,
): Promise<void> {
    if (matches.length >= limit) return;

    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (matches.length >= limit) break;
        if (IGNORED_DIRS.has(entry.name)) continue;

        const full = join(dir, entry.name);
        const rel = relative(baseDir, full);

        if (entry.isDirectory()) {
            await walkAndSearch(full, baseDir, fileRegex, contentRegex, contextLines, matches, limit);
        } else if (entry.isFile()) {
            if (!fileRegex || fileRegex.test(rel)) {
                await searchFile(full, rel, contentRegex, contextLines, matches, limit);
            }
        }
    }
}

export const grepSearchHandler: ToolHandler = async (args, ctx) => {
    const pattern = args['pattern'] as string;
    const glob = args['glob'] as string | undefined;
    const baseDir = args['base_dir'] as string | undefined ?? ctx.cwd;
    const caseInsensitive = (args['case_insensitive'] as boolean | undefined) ?? false;
    const contextLines = (args['context_lines'] as number | undefined) ?? 0;
    const limit = (args['limit'] as number | undefined) ?? 50;

    let contentRegex: RegExp;
    try {
        contentRegex = new RegExp(pattern, caseInsensitive ? 'i' : '');
    } catch {
        return `Error: invalid regex pattern: ${pattern}`;
    }

    const fileRegex = glob ? globToRegex(glob) : null;
    const matches: Match[] = [];
    await walkAndSearch(baseDir, baseDir, fileRegex, contentRegex, contextLines, matches, limit);

    if (matches.length === 0) return `No matches for: ${pattern}`;

    const lines = matches.map((m) => `${m.file}:${m.line}: ${m.content}`);
    const header = `${matches.length} match(es) for "${pattern}"${glob ? ` in ${glob}` : ''}:`;
    return `${header}\n${lines.join('\n')}`;
};
