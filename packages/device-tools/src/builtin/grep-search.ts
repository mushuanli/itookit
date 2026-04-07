// @file: device-tools/src/builtin/grep-search.ts
// 正则表达式文件内容搜索工具。

import type { ToolMeta, ToolHandler, ToolExecutionContext } from '@itookit/common';
import type { ToolDefinition } from '@itookit/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

const IGNORE_DIRS = new Set([
    '.git', 'node_modules', '__pycache__', '.venv', 'venv',
    '.tox', 'dist', 'build', '.next', '.cache',
]);

const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
    '.exe', '.dll', '.so', '.dylib', '.wasm', '.bin', '.dat', '.lock',
]);

export class GrepSearchTool {
    static readonly META: ToolMeta = {
        id: 'grep_search',
        name: 'Grep Search',
        description: 'Search file contents using a regular expression.',
        sideEffect: 'none',
        timeoutMs: 30_000,
        type: 'builtin',
        enabled: true,
        icon: '🔎',
        tags: ['search', 'content', 'regex'],
    };

    static readonly DEFINITION: ToolDefinition = {
        type: 'function',
        function: {
            name: 'grep_search',
            description: 'Search file contents using a regular expression pattern. Similar to grep -rn.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: {
                        type: 'string',
                        description: 'Regular expression pattern to search for',
                    },
                    path: {
                        type: 'string',
                        description: 'Directory or file to search in (default: cwd)',
                    },
                    include: {
                        type: 'string',
                        description: "File extension filter (e.g., '.ts', '.py')",
                    },
                    maxResults: {
                        type: 'integer',
                        description: 'Maximum number of matching lines (default 50)',
                    },
                    caseSensitive: {
                        type: 'boolean',
                        description: 'Whether case sensitive (default true)',
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
        const includeExt = args.include as string | undefined;
        const maxResults = Number(args.maxResults ?? 50);
        const caseSensitive = args.caseSensitive !== false;

        if (!fs.existsSync(basePath)) {
            return `Error: Path not found: ${basePath}`;
        }

        let regex: RegExp;
        try {
            regex = new RegExp(pattern, caseSensitive ? '' : 'i');
        } catch (err: any) {
            return `Error: Invalid regex pattern: ${err.message}`;
        }

        const matches: string[] = [];
        let filesSearched = 0;

        const filesToSearch = GrepSearchTool.collectFiles(basePath, includeExt);

        for (const filePath of filesToSearch) {
            if (matches.length >= maxResults) break;

            let content: string;
            try {
                content = fs.readFileSync(filePath, 'utf-8');
            } catch {
                continue;
            }

            filesSearched++;

            const lines = content.split('\n');
            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                if (matches.length >= maxResults) break;
                if (regex.test(lines[lineNum])) {
                    const rel = path.relative(basePath, filePath);
                    matches.push(`  ${rel}:${lineNum + 1}: ${lines[lineNum].trimEnd()}`);
                }
            }
        }

        const header = `Searched ${filesSearched} files for /${pattern}/`;
        if (matches.length === 0) {
            return `${header}\nNo matches found.`;
        }

        const result = [header, `Found ${matches.length} matches:`, ...matches];
        if (matches.length >= maxResults) {
            result.push(`\n... results truncated at ${maxResults} matches`);
        }
        return result.join('\n');
    };

    private static collectFiles(basePath: string, includeExt?: string): string[] {
        const results: string[] = [];
        const stat = fs.statSync(basePath);

        if (stat.isFile()) return [basePath];

        const walk = (dir: string) => {
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
                    walk(fullPath);
                } else if (entry.isFile()) {
                    const ext = path.extname(entry.name).toLowerCase();
                    if (BINARY_EXTENSIONS.has(ext)) continue;
                    if (includeExt && ext !== includeExt) continue;
                    results.push(fullPath);
                }
            }
        };

        walk(basePath);
        return results;
    }
}
