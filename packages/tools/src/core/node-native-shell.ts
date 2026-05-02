// @file: tools/src/core/node-native-shell.ts
// Node.js implementation of INativeShell using child_process.spawn.
//
// Usage:
//   const shell = await createNodeNativeShell();
//   toolDriver.setNativeShell(shell);
//
// The factory probes for rg and fd once at creation time, caching the result
// in shell.capabilities so tools can branch without per-call binary detection.

import type { INativeShell, NativeShellResult } from './types';

// ── Binary probe ──

async function probeCommand(command: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cp = await import('node:child_process' as any);
  return new Promise<boolean>((resolve) => {
    const proc = cp.spawn(command, ['--version'], { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('close', (code: number | null) => resolve(code === 0));
  });
}

// ── Execution ──

async function spawnCommand(
  command: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<NativeShellResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cp = await import('node:child_process' as any);

  return new Promise<NativeShellResult>((resolve, reject) => {
    const proc = cp.spawn(command, args, {
      cwd: opts?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = opts?.timeoutMs
      ? setTimeout(() => proc.kill(), opts.timeoutMs)
      : null;

    opts?.signal?.addEventListener('abort', () => proc.kill(), { once: true });

    proc.on('close', (code: number | null) => {
      if (timer) clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        code,
      });
    });

    proc.on('error', (err: Error) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`Failed to spawn ${command}: ${err.message}`));
    });
  });
}

// ── Factory ──

/**
 * Create a Node.js-backed INativeShell.
 * Probes for ripgrep (rg) and fd availability, then caches the result in
 * shell.capabilities for zero-cost branching inside tool call().
 *
 * @example
 * const shell = await createNodeNativeShell();
 * toolDriver.setNativeShell(shell);
 */
export async function createNodeNativeShell(): Promise<INativeShell> {
  const [ripgrep, fd] = await Promise.all([
    probeCommand('rg'),
    probeCommand('fd'),
  ]);

  return {
    capabilities: { ripgrep, fd },
    exec: spawnCommand,
  };
}
