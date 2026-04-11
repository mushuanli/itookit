// @file: llm-harness/src/tty/node-tty-driver.ts
//
// NodeTTYDriver — spawns child processes with pipe-based bidirectional I/O.
//
// Limitations (Phase 1):
//   supportsPty = false → programs that call isatty() may behave differently
//   (e.g., disable color output, use unbuffered mode, etc.)
//
// Upgrade path: replace NodeTTYSession internals with node-pty for a real PTY.
// The ITTYDriver/ITTYSession interface remains unchanged.

import { spawn, type ChildProcess } from 'node:child_process';
import { generateId } from '@itookit/common';
import type { ITTYDriver, ITTYSession, ITTYSpawnOptions, ITTYSessionEvents } from '@itookit/common';

// ── NodeTTYSession ────────────────────────────────────────────────────────────

export class NodeTTYSession implements ITTYSession {
    readonly id: string;
    readonly command: string;
    readonly pid: number | undefined;

    private _exited = false;
    private _exitCode: number | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private handlers: Map<string, Set<(...args: any[]) => void>> = new Map();

    constructor(
        private readonly proc: ChildProcess,
        command: string,
        args: string[],
    ) {
        this.id   = `tty_${generateId()}`;
        this.command = [command, ...args].join(' ');
        this.pid  = proc.pid;

        // Merge stdout + stderr into the 'data' event stream
        proc.stdout?.on('data', (chunk: Buffer) => {
            this.emit('data', chunk.toString());
        });
        proc.stderr?.on('data', (chunk: Buffer) => {
            this.emit('data', chunk.toString());
        });

        proc.on('close', (code, signal) => {
            this._exited   = true;
            this._exitCode = code;
            this.emit('exit', code, signal);
        });

        proc.on('error', (err) => {
            this._exited = true;
            this.emit('error', err);
        });
    }

    get exited():   boolean       { return this._exited; }
    get exitCode(): number | null { return this._exitCode; }

    write(data: string): void {
        if (this._exited || !this.proc.stdin) return;
        this.proc.stdin.write(data);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    resize(_cols: number, _rows: number): void {
        // No-op for pipe-based sessions; node-pty would call ptyProcess.resize()
    }

    kill(signal = 'SIGTERM'): void {
        if (!this._exited) this.proc.kill(signal as NodeJS.Signals);
    }

    on<E extends keyof ITTYSessionEvents>(event: E, handler: ITTYSessionEvents[E]): () => void {
        if (!this.handlers.has(event)) this.handlers.set(event, new Set());
        this.handlers.get(event)!.add(handler);
        return () => this.handlers.get(event)?.delete(handler);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private emit(event: string, ...args: any[]): void {
        for (const h of this.handlers.get(event) ?? []) h(...args);
    }
}

// ── NodeTTYDriver ─────────────────────────────────────────────────────────────

/**
 * Node.js TTY driver using child_process.spawn with pipe I/O.
 *
 * Phase 1: stdin/stdout/stderr connected via pipes.
 * Phase 2: replace with node-pty for real PTY emulation.
 */
export class NodeTTYDriver implements ITTYDriver {
    /** Phase 1 uses pipes, not a real PTY. */
    readonly supportsPty = false;

    spawn(command: string, args: string[] = [], options: ITTYSpawnOptions = {}): ITTYSession {
        const proc = spawn(command, args, {
            cwd:   options.cwd ?? process.cwd(),
            env:   { ...process.env, ...options.env },
            // Connect stdin so we can write; merge stdout/stderr for simplicity
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        const session = new NodeTTYSession(proc, command, args);

        // Wire abort signal → kill
        if (options.signal) {
            const onAbort = () => session.kill('SIGTERM');
            options.signal.addEventListener('abort', onAbort, { once: true });
            session.on('exit', () => options.signal!.removeEventListener('abort', onAbort));
        }

        return session;
    }
}
