// @file: llm-harness/src/tools/shell-exec.ts
// Shell 命令执行工具（含危险命令硬拦截）。
//
// Browser safety: spawn is loaded via dynamic import so Vite does not
// statically bundle node:child_process. In browser environments the tool
// returns an error message instead of attempting process spawn.

import type { ToolMeta, ToolDefinition, ToolHandler } from '@itookit/common';

export const shellExecMeta: ToolMeta = {
    id: 'shell_exec',
    name: 'Shell Execute',
    description: 'Execute a shell command and return stdout/stderr output',
    sideEffect: 'local',
    timeoutMs: 120_000,
    type: 'builtin',
    enabled: true,
    tags: ['shell', 'exec'],
};

export const shellExecDefinition: ToolDefinition = {
    name: 'shell_exec',
    description:
        'Execute a shell command in the working directory. ' +
        'Returns combined stdout and stderr. ' +
        'Avoid interactive commands. Use for build, test, lint, and file operations.',
    parameters: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'Shell command to execute',
            },
            timeout_ms: {
                type: 'number',
                description: 'Maximum execution time in milliseconds (default: 120000)',
            },
        },
        required: ['command'],
    },
};

// Patterns that are unconditionally blocked regardless of context.
const BLOCKED_PATTERNS: RegExp[] = [
    /rm\s+-rf\s+[/~]/,
    /:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:\s*&\s*\}/,  // fork bomb
    /mkfs\./,
    /dd\s+if=.*of=\/dev\//,
    />(\/dev\/sd|\/dev\/nvme)/,
    /shutdown|halt|reboot|poweroff/,
    /chmod\s+-R\s+777\s+\//,
];

const MAX_OUTPUT_CHARS = 50_000;

function isDangerous(command: string): string | null {
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(command)) return pattern.source;
    }
    return null;
}

export const shellExecHandler: ToolHandler = async (args, ctx) => {
    const command = args['command'] as string;
    const timeoutMs = (args['timeout_ms'] as number | undefined) ?? ctx.timeoutMs;

    const danger = isDangerous(command);
    if (danger) {
        return `Error: command blocked by safety filter (pattern: ${danger})`;
    }

    // Dynamic import keeps node:child_process out of the browser bundle.
    let spawnFn: typeof import('node:child_process').spawn;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cp = await import('node:child_process' as any);
        spawnFn = cp.spawn;
    } catch {
        return 'Error: shell_exec is not available in browser environments';
    }

    return new Promise((resolve) => {
        const chunks: string[] = [];
        let timedOut = false;

        const proc = spawnFn('sh', ['-c', command], {
            cwd: ctx.cwd,
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill('SIGTERM');
        }, timeoutMs);

        const onData = (chunk: Buffer) => {
            chunks.push(chunk.toString());
            const total = chunks.reduce((s, c) => s + c.length, 0);
            if (total > MAX_OUTPUT_CHARS) proc.kill('SIGTERM');
        };

        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);

        ctx.signal?.addEventListener('abort', () => {
            proc.kill('SIGTERM');
        });

        proc.on('close', (code: number | null) => {
            clearTimeout(timer);
            let output = chunks.join('');
            if (output.length > MAX_OUTPUT_CHARS) {
                output = output.slice(0, MAX_OUTPUT_CHARS) + '\n[output truncated]';
            }
            if (timedOut) {
                output = `[timeout after ${timeoutMs}ms]\n${output}`;
            }
            const exitInfo = timedOut ? 'timeout' : `exit ${code ?? '?'}`;
            resolve(`$ ${command}\n[${exitInfo}]\n${output}`);
        });

        proc.on('error', (err: Error) => {
            clearTimeout(timer);
            resolve(`Error spawning command: ${err.message}`);
        });
    });
};
