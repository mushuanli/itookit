// @file: llm-harness/src/tools/file-write.ts
// 文件写入工具（支持创建/覆盖/字符串替换）。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { ToolMeta, ToolDefinition, ToolHandler } from '@itookit/common';

export const fileWriteMeta: ToolMeta = {
    id: 'file_write',
    name: 'Write File',
    description: 'Create or modify a file. Supports full overwrite and string replacement modes.',
    sideEffect: 'local',
    timeoutMs: 10_000,
    type: 'builtin',
    enabled: true,
    tags: ['file', 'write'],
};

export const fileWriteDefinition: ToolDefinition = {
    name: 'file_write',
    description:
        'Create or modify a file. ' +
        'Use mode="overwrite" to create/replace the entire file. ' +
        'Use mode="replace" to replace a specific string within an existing file.',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Absolute or relative path to the file',
            },
            content: {
                type: 'string',
                description: 'New file content (for mode=overwrite) or replacement string (for mode=replace)',
            },
            mode: {
                type: 'string',
                enum: ['overwrite', 'replace'],
                description: 'Write mode: "overwrite" replaces the entire file, "replace" replaces old_string with content',
            },
            old_string: {
                type: 'string',
                description: 'String to replace (required when mode=replace). Must be unique in the file.',
            },
        },
        required: ['path', 'content', 'mode'],
    },
};

export const fileWriteHandler: ToolHandler = async (args, ctx) => {
    const path = args['path'] as string;
    const content = args['content'] as string;
    const mode = (args['mode'] as string) ?? 'overwrite';
    const absPath = resolve(ctx.cwd, path);

    await mkdir(dirname(absPath), { recursive: true });

    if (mode === 'replace') {
        const oldString = args['old_string'] as string | undefined;
        if (!oldString) return 'Error: old_string is required when mode=replace';

        let existing: string;
        try {
            existing = await readFile(absPath, 'utf-8');
        } catch {
            return `Error: file does not exist for replace mode: ${absPath}`;
        }

        const count = existing.split(oldString).length - 1;
        if (count === 0) return `Error: old_string not found in file: ${absPath}`;
        if (count > 1) return `Error: old_string matches ${count} locations (must be unique): ${absPath}`;

        await writeFile(absPath, existing.replace(oldString, content), 'utf-8');
        return `Replaced 1 occurrence in ${absPath}`;
    }

    await writeFile(absPath, content, 'utf-8');
    const lines = content.split('\n').length;
    return `Written ${lines} lines to ${absPath}`;
};
