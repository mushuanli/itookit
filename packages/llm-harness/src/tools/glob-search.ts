// @file: llm-harness/src/tools/glob-search.ts
// Glob 文件搜索工具。
//
// Browser safety: node:fs/promises and node:path are loaded via dynamic
// import so Vite does not statically bundle them into the browser build.

import type { ToolMeta, ToolDefinition, ToolHandler } from '@itookit/common';

export const globSearchMeta: ToolMeta = {
    id: 'glob_search',
    name: 'Glob Search',
    description: 'Find files matching a glob pattern',
    sideEffect: 'none',
    timeoutMs: 30_000,
    type: 'builtin',
    enabled: true,
    tags: ['file', 'search'],
};

export const globSearchDefinition: ToolDefinition = {
    name: 'glob_search',
    description:
        'Find files matching a glob pattern (e.g. "**/*.ts", "src/**/*.tsx"). ' +
        'Returns matching paths sorted by modification time (newest first). ' +
        'Automatically ignores node_modules, dist, .git, and build directories.',
    parameters: {
        type: 'object',
        properties: {
            pattern: {
                type: 'string',
                description: 'Glob pattern to match files against',
            },
            base_dir: {
                type: 'string',
                description: 'Base directory for the search (default: working directory)',
            },
            limit: {
                type: 'number',
                description: 'Maximum number of results (default: 100)',
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

// fs/path passed as deps to avoid top-level node: imports (browser safety).
interface FsDeps {
    readdir: typeof import('node:fs/promises').readdir;
    stat: typeof import('node:fs/promises').stat;
    join: typeof import('node:path').join;
    relative: typeof import('node:path').relative;
}

async function walkDir(
    dir: string,
    baseDir: string,
    regex: RegExp,
    results: Array<{ path: string; mtime: number }>,
    limit: number,
    deps: FsDeps,
): Promise<void> {
    if (results.length >= limit) return;

    let entries;
    try {
        entries = await deps.readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (results.length >= limit) break;
        if (IGNORED_DIRS.has(entry.name)) continue;

        const full = deps.join(dir, entry.name);
        const rel = deps.relative(baseDir, full);

        if (entry.isDirectory()) {
            await walkDir(full, baseDir, regex, results, limit, deps);
        } else if (entry.isFile() && regex.test(rel)) {
            try {
                const s = await deps.stat(full);
                results.push({ path: rel, mtime: s.mtimeMs });
            } catch {
                results.push({ path: rel, mtime: 0 });
            }
        }
    }
}

export const globSearchHandler: ToolHandler = async (args, ctx) => {
    let deps: FsDeps;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fs = await import('node:fs/promises' as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nodePath = await import('node:path' as any);
        deps = { readdir: fs.readdir, stat: fs.stat, join: nodePath.join, relative: nodePath.relative };
    } catch {
        return 'Error: glob_search is not available in browser environments';
    }

    const pattern = args['pattern'] as string;
    const baseDir = args['base_dir'] as string | undefined ?? ctx.cwd;
    const limit = (args['limit'] as number | undefined) ?? 100;

    const regex = globToRegex(pattern);
    const results: Array<{ path: string; mtime: number }> = [];
    await walkDir(baseDir, baseDir, regex, results, limit, deps);

    results.sort((a, b) => b.mtime - a.mtime);
    const paths = results.map((r) => r.path);

    if (paths.length === 0) return `No files matching: ${pattern}`;
    return `${paths.length} file(s) matching "${pattern}":\n${paths.join('\n')}`;
};
