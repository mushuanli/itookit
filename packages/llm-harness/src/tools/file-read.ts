// @file: llm-harness/src/tools/file-read.ts
// 文件读取工具。
//
// Browser safety: node:fs/promises and node:path are loaded via dynamic
// import so Vite does not statically bundle them into the browser build.

import type { ToolMeta, ToolDefinition, ToolHandler } from '@itookit/common';

export const fileReadMeta: ToolMeta = {
    id: 'file_read',
    name: 'Read File',
    description: 'Read the contents of a file with optional line offset and limit',
    sideEffect: 'none',
    timeoutMs: 10_000,
    type: 'builtin',
    enabled: true,
    tags: ['file', 'read'],
};

export const fileReadDefinition: ToolDefinition = {
    name: 'file_read',
    description:
        'Read the contents of a file. Returns file content with line numbers. ' +
        'Use offset and limit to read specific sections of large files.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Absolute or relative path to the file',
            },
            offset: {
                type: 'number',
                description: 'Line number to start reading from (1-indexed). Omit to read from start.',
            },
            limit: {
                type: 'number',
                description: 'Maximum number of lines to read. Omit to read all lines.',
            },
        },
        required: ['path'],
    },
};

const MAX_OUTPUT_LINES = 2000;

export const fileReadHandler: ToolHandler = async (args, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let readFile: typeof import('node:fs/promises').readFile;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolvePath: typeof import('node:path').resolve;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fs = await import('node:fs/promises' as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const nodePath = await import('node:path' as any);
        readFile = fs.readFile;
        resolvePath = nodePath.resolve;
        // node:path may be polyfilled in browser but resolve() is often missing
        if (typeof readFile !== 'function' || typeof resolvePath !== 'function') {
            throw new Error('incomplete Node.js API');
        }
    } catch {
        return 'Error: file_read is not available in browser environments';
    }

    const path = args['path'] as string;
    const offset = (args['offset'] as number | undefined) ?? 1;
    const limit = (args['limit'] as number | undefined) ?? MAX_OUTPUT_LINES;

    const absPath = resolvePath(ctx.cwd, path);

    let content: string;
    try {
        content = await readFile(absPath, 'utf-8');
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error reading file: ${msg}`;
    }

    const lines = content.split('\n');
    const startIdx = Math.max(0, offset - 1);
    const endIdx = Math.min(lines.length, startIdx + limit);
    const selected = lines.slice(startIdx, endIdx);

    const formatted = selected
        .map((line, i) => `${String(startIdx + i + 1).padStart(6)} ${line}`)
        .join('\n');

    const totalLines = lines.length;
    const header = `File: ${absPath} (lines ${startIdx + 1}-${endIdx} of ${totalLines})`;
    return `${header}\n${'─'.repeat(60)}\n${formatted}`;
};
