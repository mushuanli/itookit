// @file: device-tools/src/builtin/shell-exec.ts
// Shell 命令执行工具。

import type { ToolMeta, ToolHandler, ToolExecutionContext } from '@itookit/common';
import type { ToolDefinition } from '@itookit/common';
import { exec } from 'node:child_process';

/**
 * 截断文本，保留首尾。
 */
function truncateOutput(text: string, maxLines = 200): string {
    const lines = text.split('\n');
    if (lines.length <= maxLines) return text;

    const half = Math.floor(maxLines / 2);
    const head = lines.slice(0, half).join('\n');
    const tail = lines.slice(-half).join('\n');
    const snipped = lines.length - maxLines;
    return `${head}\n\n... [${snipped} lines truncated] ...\n\n${tail}`;
}

export class ShellExecTool {
    /**
     * 无条件拦截的危险命令模式。
     * 匹配这些模式的命令直接拒绝执行，不可通过权限覆盖。
     */
    private static readonly CATASTROPHIC_PATTERNS = [
        /rm\s+-rf\s+\/(?!\S)/,          // rm -rf /
        /mkfs\./,                        // 格式化磁盘
        /dd\s+.*of=\/dev\//,             // 覆写设备
        /:\(\)\{.*\|.*&\s*\};:/,         // fork bomb
        />(\/dev\/[hs]d|\/dev\/nvme)/,   // 覆写块设备
    ];

    static readonly META: ToolMeta = {
        id: 'shell_exec',
        name: 'Shell Execute',
        description: 'Execute a shell command.',
        sideEffect: 'local',
        timeoutMs: 120_000,
        type: 'builtin',
        enabled: true,
        icon: '💻',
        tags: ['shell', 'command'],
    };

    static readonly DEFINITION: ToolDefinition = {
        type: 'function',
        function: {
            name: 'shell_exec',
            description:
                'Execute a shell command. Use for running tests, installing packages, searching with grep/find, git operations, etc.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The shell command to execute',
                    },
                    timeout: {
                        type: 'integer',
                        description: 'Timeout in seconds (default 60)',
                    },
                },
                required: ['command'],
            },
        },
    };

    static readonly handler: ToolHandler = async (
        args: Record<string, unknown>,
        ctx: ToolExecutionContext,
    ): Promise<string> => {
        const command = String(args.command);
        const timeoutSec = Math.min(
            Number(args.timeout ?? 60),
            ctx.timeoutMs / 1000,
        );

        // 危险命令检测（硬拒绝，不可覆盖）
        for (const pattern of ShellExecTool.CATASTROPHIC_PATTERNS) {
            if (pattern.test(command)) {
                return (
                    `Error: Refused to execute potentially destructive command: ${command}\n` +
                    `This command matches a blocked pattern.`
                );
            }
        }

        return new Promise<string>((resolve) => {
            const child = exec(command, {
                cwd: ctx.cwd,
                timeout: timeoutSec * 1000,
                maxBuffer: 10 * 1024 * 1024, // 10 MB
                env: { ...process.env },
            });

            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (chunk) => {
                stdout += chunk;
            });
            child.stderr?.on('data', (chunk) => {
                stderr += chunk;
            });

            // 监听取消信号
            if (ctx.signal) {
                const abortHandler = () => {
                    child.kill('SIGTERM');
                    resolve('Error: Command aborted by user.');
                };
                ctx.signal.addEventListener('abort', abortHandler, { once: true });

                child.on('close', () => {
                    ctx.signal?.removeEventListener('abort', abortHandler);
                });
            }

            child.on('close', (code) => {
                const parts: string[] = [`Exit code: ${code ?? 'unknown'}`];
                if (stdout.trim()) {
                    parts.push(`STDOUT:\n${truncateOutput(stdout)}`);
                }
                if (stderr.trim()) {
                    parts.push(`STDERR:\n${truncateOutput(stderr)}`);
                }
                resolve(parts.join('\n\n'));
            });

            child.on('error', (err) => {
                if (err.message.includes('ETIMEDOUT') || err.message.includes('timeout')) {
                    resolve(`Error: Command timed out after ${timeoutSec}s: ${command}`);
                } else {
                    resolve(`Error: ${err.message}`);
                }
            });
        });
    };
}
