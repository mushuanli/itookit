// @file: apps/tauri-app/src/shell/tauri-native-shell.ts
// Tauri implementation of INativeShell.
//
// Routes exec() calls through Rust Tauri commands instead of node:child_process.
// Supported commands: rg, fd, sh (maps to shell_exec).
// All other commands throw — keep the surface minimal.
//
// Usage in main.ts bootstrap:
//   const shell = await TauriNativeShell.create();
//   toolDriver.setNativeShell(shell);
//   // Optionally register a Tauri-native BashTool:
//   toolDriver.registerToolInstance(createBashTool(shell));

import { invoke } from '@tauri-apps/api/core';
import type { INativeShell, NativeShellResult } from '@itookit/tools';

interface NativeCapabilities {
  ripgrep: boolean;
  fd: boolean;
}

export class TauriNativeShell implements INativeShell {
  readonly capabilities: { ripgrep: boolean; fd: boolean };

  private constructor(caps: NativeCapabilities) {
    this.capabilities = { ripgrep: caps.ripgrep, fd: caps.fd };
  }

  /**
   * Create a TauriNativeShell by querying the Rust backend for available binaries.
   * Call once at bootstrap and inject into ToolDeviceDriver.
   */
  static async create(): Promise<TauriNativeShell> {
    const caps = await invoke<NativeCapabilities>('native_capabilities');
    return new TauriNativeShell(caps);
  }

  async exec(
    command: string,
    args: string[],
    opts?: { cwd?: string; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<NativeShellResult> {
    // Abort via signal is best-effort in Tauri IPC (no kill API without plugin-shell).
    if (opts?.signal?.aborted) {
      return { stdout: '', stderr: 'Aborted', code: null };
    }

    switch (command) {
      case 'rg': {
        // args from GrepTool: --json --case-insensitive --glob ! ... -e <pattern> <dir>
        const pattern = extractArgValue(args, '-e') ?? args.at(-2) ?? '';
        const dir = args.at(-1) ?? opts?.cwd ?? '.';
        const glob = extractArgValue(args, '--glob', (v) => !v.startsWith('!'));
        const stdout = await invoke<string>('search_ripgrep', {
          pattern,
          dir,
          glob: glob ?? null,
          maxResults: null,
        });
        return { stdout, stderr: '', code: 0 };
      }

      case 'fd': {
        // args from GlobTool: --type f --max-results 100 --exclude ... --glob <pat> <dir>
        const pattern = extractArgValue(args, '--glob') ?? args.at(-2) ?? '';
        const dir = args.at(-1) ?? opts?.cwd ?? '.';
        const stdout = await invoke<string>('search_fd', {
          pattern,
          dir,
          maxResults: null,
        });
        return { stdout, stderr: '', code: 0 };
      }

      case 'sh': {
        // args from BashTool: ['-c', command]
        const shellCmd = args[1] ?? args[0] ?? '';
        const cwd = opts?.cwd ?? '.';
        const [stdout, code] = await invoke<[string, number]>('shell_exec', {
          command: shellCmd,
          cwd,
        });
        return { stdout, stderr: '', code };
      }

      default:
        throw new Error(`TauriNativeShell: unsupported command "${command}"`);
    }
  }
}

// ── Helpers ──

/** Extract the value following a flag, with optional predicate filter. */
function extractArgValue(
  args: string[],
  flag: string,
  predicate?: (v: string) => boolean,
): string | undefined {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === flag) {
      const v = args[i + 1];
      if (!predicate || predicate(v)) return v;
    }
  }
  return undefined;
}
