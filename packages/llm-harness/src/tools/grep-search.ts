// @file: llm-harness/src/tools/grep-search.ts
// 内容搜索工具（正则，path:行号 格式输出）。
//
// 运行环境优先级：
//   1. ctx.vfs  → 浏览器 VFS（vfslib.listFiles + readFile）
//   2. node:fs  → Node.js 真实文件系统

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
            pattern:         { type: 'string',  description: 'Regular expression pattern to search for' },
            glob:            { type: 'string',  description: 'File glob filter (e.g. "*.ts"). Defaults to all text files.' },
            base_dir:        { type: 'string',  description: 'Base directory for the search (default: working directory)' },
            case_insensitive:{ type: 'boolean', description: 'Case-insensitive matching (default: false)' },
            context_lines:   { type: 'number',  description: 'Number of context lines before/after each match (default: 0)' },
            limit:           { type: 'number',  description: 'Maximum number of matches to return (default: 50)' },
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

interface FsDeps {
    readFile: typeof import('node:fs/promises').readFile;
    readdir:  typeof import('node:fs/promises').readdir;
    join:     typeof import('node:path').join;
    relative: typeof import('node:path').relative;
}

async function searchFile(
    filePath: string, relPath: string, regex: RegExp,
    contextLines: number, matches: Match[], limit: number, deps: FsDeps,
): Promise<void> {
    if (matches.length >= limit) return;
    const buf = await deps.readFile(filePath).catch(() => null);
    if (!buf || isBinary(buf as Buffer)) return;
    const lines = (buf as Buffer).toString('utf-8').split('\n');
    for (let i = 0; i < lines.length && matches.length < limit; i++) {
        if (!regex.test(lines[i])) continue;
        if (contextLines === 0) {
            matches.push({ file: relPath, line: i + 1, content: lines[i] });
        } else {
            const start = Math.max(0, i - contextLines);
            const end   = Math.min(lines.length - 1, i + contextLines);
            for (let j = start; j <= end && matches.length < limit; j++) {
                matches.push({ file: relPath, line: j + 1, content: lines[j] });
            }
        }
    }
}

async function walkAndSearch(
    dir: string, baseDir: string, fileRegex: RegExp | null, contentRegex: RegExp,
    contextLines: number, matches: Match[], limit: number, deps: FsDeps,
): Promise<void> {
    if (matches.length >= limit) return;
    let entries;
    try { entries = await deps.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
        if (matches.length >= limit) break;
        if (IGNORED_DIRS.has(entry.name)) continue;
        const full = deps.join(dir, entry.name);
        const rel  = deps.relative(baseDir, full);
        if (entry.isDirectory()) {
            await walkAndSearch(full, baseDir, fileRegex, contentRegex, contextLines, matches, limit, deps);
        } else if (entry.isFile() && (!fileRegex || fileRegex.test(rel))) {
            await searchFile(full, rel, contentRegex, contextLines, matches, limit, deps);
        }
    }
}

export const grepSearchHandler: ToolHandler = async (args, ctx) => {
    const pattern         = args['pattern']          as string;
    const glob            = args['glob']              as string | undefined;
    const baseDir         = (args['base_dir']         as string | undefined) ?? ctx.cwd;
    const caseInsensitive = (args['case_insensitive'] as boolean | undefined) ?? false;
    const contextLines    = (args['context_lines']    as number | undefined) ?? 0;
    const limit           = (args['limit']            as number | undefined) ?? 50;

    let contentRegex: RegExp;
    try {
        contentRegex = new RegExp(pattern, caseInsensitive ? 'i' : '');
    } catch {
        return `Error: invalid regex pattern: ${pattern}`;
    }
    const fileRegex = glob ? globToRegex(glob) : null;

    // ── Path A: VFS (browser) ──────────────────────────────────────────────
    if (ctx.vfs) {
        const allFiles = await ctx.vfs.listFiles(baseDir).catch(() => [] as string[]);
        const matches: Match[] = [];
        for (const relPath of allFiles) {
            if (matches.length >= limit) break;
            if (fileRegex && !fileRegex.test(relPath)) continue;
            const text = await ctx.vfs.readFile(relPath).catch(() => null);
            if (!text) continue;
            const lines = text.split('\n');
            for (let i = 0; i < lines.length && matches.length < limit; i++) {
                if (!contentRegex.test(lines[i])) continue;
                if (contextLines === 0) {
                    matches.push({ file: relPath, line: i + 1, content: lines[i] });
                } else {
                    const start = Math.max(0, i - contextLines);
                    const end   = Math.min(lines.length - 1, i + contextLines);
                    for (let j = start; j <= end && matches.length < limit; j++) {
                        matches.push({ file: relPath, line: j + 1, content: lines[j] });
                    }
                }
            }
        }
        if (matches.length === 0) return `No matches for: ${pattern}`;
        return `${matches.length} match(es) for "${pattern}"${glob ? ` in ${glob}` : ''}:\n${matches.map((m) => `${m.file}:${m.line}: ${m.content}`).join('\n')}`;
    }

    // ── Path B: Node.js real filesystem ───────────────────────────────────
    let deps: FsDeps;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fs       = await import('node:fs/promises' as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nodePath = await import('node:path' as any);
        deps = { readFile: fs.readFile, readdir: fs.readdir, join: nodePath.join, relative: nodePath.relative };
        if (typeof deps.readFile !== 'function' || typeof deps.join !== 'function') {
            throw new Error('incomplete Node.js API');
        }
    } catch {
        return 'Error: grep_search is not available in this environment (no VFS context injected and no Node.js fs API)';
    }

    const matches: Match[] = [];
    await walkAndSearch(baseDir, baseDir, fileRegex, contentRegex, contextLines, matches, limit, deps);
    if (matches.length === 0) return `No matches for: ${pattern}`;
    return `${matches.length} match(es) for "${pattern}"${glob ? ` in ${glob}` : ''}:\n${matches.map((m) => `${m.file}:${m.line}: ${m.content}`).join('\n')}`;
};
