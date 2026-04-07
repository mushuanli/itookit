// @file: device-tools/src/builtin/file-read.ts
// 文件读取工具。

import type { ToolMeta, ToolHandler, ToolExecutionContext } from '@itookit/common';
import type { ToolDefinition } from '@itookit/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

export class FileReadTool {
    static readonly META: ToolMeta = {
        id: 'file_read',
        name: 'File Read',
        description: 'Read the contents of a file at the given path.',
        sideEffect: 'none',
        timeoutMs: 10_000,
        type: 'builtin',
        enabled: true,
        icon: '📄',
        tags: ['file', 'read'],
    };

    static readonly DEFINITION: ToolDefinition = {
        type: 'function',
        function: {
            name: 'file_read',
            description: 'Read the contents of a file at the given path.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Absolute or relative file path to read',
                    },
                    offset: {
                        type: 'integer',
                        description: 'Line number to start reading from (0-indexed)',
                    },
                    limit: {
                        type: 'integer',
                        description: 'Maximum number of lines to read (default 500)',
                    },
                },
                required: ['path'],
            },
        },
    };

    static readonly handler: ToolHandler = async (
        args: Record<string, unknown>,
        ctx: ToolExecutionContext,
    ): Promise<string> => {
        const rawPath = String(args.path);
        const filePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.cwd, rawPath);
        const offset = Number(args.offset ?? 0);
        const limit = Number(args.limit ?? 500);

        if (!fs.existsSync(filePath)) {
            return `Error: File not found: ${filePath}`;
        }

        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
            return `Error: Not a file: ${filePath}`;
        }

        let content: string;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch (err: any) {
            if (err.code === 'EACCES') return `Error: Permission denied: ${filePath}`;
            return `Error: ${err.message}`;
        }

        const lines = content.split('\n');
        const totalLines = lines.length;
        const selected = lines.slice(offset, offset + limit);

        const parts: string[] = [`File: ${filePath} (${totalLines} lines total)`];

        if (offset > 0 || offset + limit < totalLines) {
            parts.push(`Showing lines ${offset}-${Math.min(offset + limit, totalLines) - 1}`);
        }

        parts.push('');
        selected.forEach((line, i) => {
            parts.push(`${String(offset + i).padStart(4)} | ${line}`);
        });

        if (offset + limit < totalLines) {
            parts.push(`\n... ${totalLines - offset - limit} more lines not shown`);
        }

        return parts.join('\n');
    };
}
