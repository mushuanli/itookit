// @file: device-tools/src/builtin/glob-search.ts
// Glob 文件搜索工具。

import type { ToolMeta, ToolHandler, ToolExecutionContext } from '@itookit/common';
import type { ToolDefinition } from '@itookit/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

const IGNORE_DIRS = new Set([
    '.git', 'node_modules', '__pycache__', '.venv', 'venv',
    '.tox', 'dist', 'build', '.next', '.cache',
]);

export class GlobSearchTool {
    static readonly META: ToolMeta = {
        id: 'glob_search',
        name: 'Glob Search',
        description: 'Search for files matching a glob pattern.',
        sideEffect: 'none',
        timeoutMs: 30_000,
        type: 'builtin',
        enabled: true,
        icon: '🔍',
        tags: ['search', 'file'],
    };

    static readonly DEFINITION: ToolDefinition = {
        type: 'function',
        function: {
            name: 'glob_search',
            description: "Search for files matching a glob pattern (e.g., '**/*.ts', 'src/**/*.py').",
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Glob pattern',
                    },
                    path: {
                        type: 'string',
                        description: 'Base directory (default: cwd)',
                    },
                    maxResults: {
                        type: 'integer',
                        description: 'Maximum results to return (default 100)',
                    },
                },
                required: ['pattern'],
            },
        },
    };

    static readonly handler: ToolHandler = async (
        args: Record<string, unknown>,
        ctx: ToolExecutionContext,
    ): Promise<string> => {
        const pattern = String(args.pattern);
        const basePath = args.path
            ? path.resolve(ctx.cwd, String(args.path))
            : ctx.cwd;
        const maxResults = Number(args.maxResults ?? 100);

        if (!fs.existsSync(basePath)) {
            return `Error: Directory not found: ${basePath}`;
        }

        // 简单的递归 glob 实现（不依赖第三方库）
        const matches: string[] = [];
        const globRegex = GlobSearchTool.globToRegex(pattern);

        GlobSearchTool.walkDir(basePath, (filePath) => {
            if (matches.length >= maxResults + 1) return false; // 停止遍历

            const relative = path.relative(basePath, filePath);
            if (globRegex.test(relative)) {
                matches.push(relative);
            }
            return true; // 继续遍历
        });

        const total = matches.length;
        const truncated = matches.sort().slice(0, maxResults);

        const lines = [
            `Found ${Math.min(total, maxResults)}${total > maxResults ? '+' : ''} matches for '${pattern}' in ${basePath}:`,
        ];
        for (const m of truncated) {
            const fullPath = path.join(basePath, m);
            const isDir = fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
            lines.push(`  ${m}${isDir ? '/' : ''}`);
        }

        if (total > maxResults) {
            lines.push(`\n... and more results (truncated at ${maxResults})`);
        }

        return lines.join('\n');
    };

    /**
     * 简易 glob → RegExp 转换
     */
    private static globToRegex(pattern: string): RegExp {
        let regex = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&') // 转义特殊字符
            .replace(/\*\*/g, '{{GLOBSTAR}}')       // 临时标记
            .replace(/\*/g, '[^/]*')                 // * → 不含 / 的任意字符
            .replace(/\?/g, '[^/]')                  // ? → 单个非 / 字符
            .replace(/\{\{GLOBSTAR\}\}/g, '.*');     // ** → 任意字符

        return new RegExp(`^${regex}$`);
    }

    /**
     * 递归遍历目录
     */
    private static walkDir(
        dir: string,
        callback: (filePath: string) => boolean,
    ): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (IGNORE_DIRS.has(entry.name)) continue;

            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                const shouldContinue = callback(fullPath);
                if (shouldContinue) {
                    GlobSearchTool.walkDir(fullPath, callback);
                }
            } else if (entry.isFile()) {
                const shouldContinue = callback(fullPath);
                if (!shouldContinue) return;
            }
        }
    }
}
