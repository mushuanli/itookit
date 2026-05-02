// @file: tools/src/tools/Bash/BashTool.ts
// Shell command execution tool.
//
// Factory pattern: createBashTool(shell?) enables the tool in Tauri
// where node:child_process is unavailable.
//
// Execution priority inside call():
//   1. context.shell (runtime-injected via ToolDeviceDriver.setNativeShell)
//   2. shell arg     (construction-time injected via createBashTool(shell))
//   3. Node.js       (child_process.spawn — default for CLI/server)
//   4. throw         (browser without any shell — tool should be disabled)

import { z } from 'zod/v4';
import { buildTool, type ToolDef } from '../../core/Tool';
import { lazySchema } from '../../core/lazySchema';
import { BASH_TOOL_NAME, DESCRIPTION } from './prompt';
import type { INativeShell } from '../../core/types';

const MAX_OUTPUT_CHARS = 50_000;

// Patterns that are unconditionally blocked regardless of execution backend
const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+[/~]/,
  /:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:\s*&\s*\}/,
  /mkfs\./,
  /dd\s+if=.*of=\/dev\//,
  />(\/dev\/sd|\/dev\/nvme)/,
  /shutdown|halt|reboot|poweroff/,
  /chmod\s+-R\s+777\s+\//,
];

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z.string().describe('The shell command to execute'),
    timeout_ms: z.number().optional().describe('Maximum execution time in milliseconds (default: 120000)'),
  }),
);
type InputSchema = ReturnType<typeof inputSchema>;

const outputSchema = lazySchema(() =>
  z.object({
    stdout: z.string().describe('Command output (combined stdout and stderr)'),
    exitCode: z.number().nullable().describe('Process exit code'),
    truncated: z.boolean().describe('Whether output was truncated'),
  }),
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

function isDangerous(command: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) return pattern.source;
  }
  return null;
}

// ── Node.js spawn implementation ──

async function spawnNode(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Output> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cp = await import('node:child_process' as any);
  const spawn = cp.spawn as typeof import('node:child_process').spawn;

  return new Promise<Output>((resolve, reject) => {
    const chunks: string[] = [];
    let timedOut = false;

    const proc = spawn('sh', ['-c', command], {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      chunks.push(chunk.toString());
      const total = chunks.reduce((s, c) => s + c.length, 0);
      if (total > MAX_OUTPUT_CHARS) proc.kill();
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    signal?.addEventListener('abort', () => proc.kill(), { once: true });

    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      let output = chunks.join('');
      const truncated = output.length > MAX_OUTPUT_CHARS;
      if (truncated) output = output.slice(0, MAX_OUTPUT_CHARS);
      if (timedOut) output = `[timeout after ${timeoutMs}ms]\n${output}`;
      resolve({ stdout: output, exitCode: timedOut ? null : code, truncated });
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn command: ${err.message}`));
    });
  });
}

// ── Factory ──

/**
 * Create a Bash tool.
 *
 * @param shell - Optional native shell for Tauri environments where
 *   node:child_process is unavailable. The shell's exec() receives
 *   ('sh', ['-c', command]) just like the Node.js path.
 *
 * @example (Tauri)
 *   const tauriShell = await TauriNativeShell.create();
 *   const BashTool = createBashTool(tauriShell);
 *   toolDriver.registerToolInstance(BashTool);
 */
export function createBashTool(shell?: INativeShell) {
  return buildTool({
    name: BASH_TOOL_NAME,
    searchHint: 'execute shell commands',
    maxResultSizeChars: MAX_OUTPUT_CHARS,

    async description() { return DESCRIPTION; },

    userFacingName(input) {
      return input?.command ? `$ ${input.command.slice(0, 60)}` : 'Bash';
    },

    getToolUseSummary(input) {
      if (!input?.command) return null;
      const cmd = input.command.trim().split('\n')[0];
      return cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
    },

    getActivityDescription(input) {
      return input?.command ? `Running ${input.command.slice(0, 50)}` : 'Running command';
    },

    get inputSchema(): InputSchema { return inputSchema(); },
    get outputSchema(): OutputSchema { return outputSchema(); },

    isConcurrencySafe() { return false; },
    isReadOnly() { return false; },

    isEnabled() {
      // Enabled when: an explicit shell is provided (Tauri), OR Node.js is available.
      if (shell) return true;
      return typeof process !== 'undefined' && typeof process.versions?.node === 'string';
    },

    async prompt() { return DESCRIPTION; },

    async validateInput(input) {
      const danger = isDangerous(input.command);
      if (danger) {
        return { result: false, message: `Command blocked by safety filter (pattern: ${danger})`, errorCode: 1 };
      }
      return { result: true };
    },

    async call(input, context) {
      const timeoutMs = input.timeout_ms ?? context.timeoutMs;
      // Prefer runtime-injected shell, then construction-time shell, then Node.js.
      const sh = context.shell ?? shell;

      if (sh) {
        const result = await sh.exec('sh', ['-c', input.command], {
          cwd: context.cwd,
          timeoutMs,
          signal: context.signal,
        });
        const combined = result.stdout + (result.stderr ? '\n[stderr]\n' + result.stderr : '');
        const truncated = combined.length > MAX_OUTPUT_CHARS;
        return {
          data: {
            stdout: truncated ? combined.slice(0, MAX_OUTPUT_CHARS) : combined,
            exitCode: result.code,
            truncated,
          },
        };
      }

      if (typeof process !== 'undefined' && typeof process.versions?.node === 'string') {
        return { data: await spawnNode(input.command, context.cwd, timeoutMs, context.signal) };
      }

      throw new Error('BashTool requires Node.js or a native shell (inject via createBashTool(shell) or ToolDeviceDriver.setNativeShell())');
    },

    mapToolResultToToolResultBlockParam(output, toolUseID) {
      const prefix = output.exitCode === null ? '[timeout]' : `[exit ${output.exitCode}]`;
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `${prefix}\n${output.stdout}${output.truncated ? '\n[output truncated]' : ''}`,
      };
    },
  } satisfies ToolDef<InputSchema, Output>);
}

/** Default Bash tool instance (Node.js mode, disabled in browsers). */
export const BashTool = createBashTool();
