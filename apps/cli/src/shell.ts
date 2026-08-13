import { spawn } from 'node:child_process';
import path from 'node:path';
import type { INativeShell, NativeShellResult } from '@itookit/tools';
import type { CompiledWorkflow, SandboxConfig, WorkspaceGrant } from './types';

const MAX_OUTPUT = 50_000;

export interface SandboxDoctorResult {
    engine?: 'podman' | 'docker';
    available: boolean;
    message: string;
}

export class NodeNativeShell implements INativeShell {
    readonly capabilities = { ripgrep: false, fd: false };

    async exec(
        command: string,
        args: string[],
        options: { cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {},
    ): Promise<NativeShellResult> {
        const invocation = nativeInvocation(command, args);
        return runProcess(invocation.command, invocation.args, {
            cwd: options.cwd,
            timeoutMs: options.timeoutMs,
            signal: options.signal,
            env: safeEnvironment(),
        });
    }
}

export class OciSandboxShell implements INativeShell {
    readonly capabilities = { ripgrep: false, fd: false };

    constructor(
        private readonly engine: 'podman' | 'docker',
        private readonly workflow: CompiledWorkflow,
        private readonly grants: () => WorkspaceGrant[],
    ) {}

    async exec(
        command: string,
        args: string[],
        options: { cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {},
    ): Promise<NativeShellResult> {
        const shellCommand = command === 'sh' && args[0] === '-c' ? args[1] : quote([command, ...args]);
        const runArgs = sandboxArgs(this.workflow, this.grants(), shellCommand, options.cwd);
        return runProcess(this.engine, runArgs, {
            timeoutMs: options.timeoutMs,
            signal: options.signal,
            env: safeEnvironment(),
        });
    }
}

export async function createShell(
    workflow: CompiledWorkflow,
    grants: () => WorkspaceGrant[],
): Promise<INativeShell> {
    if ((workflow.config.sandbox?.mode ?? 'oci') === 'native') return new NodeNativeShell();
    const doctor = await sandboxDoctor(workflow.config.sandbox?.engine ?? 'auto');
    if (!doctor.available || !doctor.engine) throw new Error(doctor.message);
    return new OciSandboxShell(doctor.engine, workflow, grants);
}

export async function sandboxDoctor(
    preferred: NonNullable<SandboxConfig['engine']> = 'auto',
): Promise<SandboxDoctorResult> {
    const candidates: Array<'podman' | 'docker'> = preferred === 'auto' ? ['podman', 'docker'] : [preferred];
    for (const engine of candidates) {
        const result = await runProcess(engine, ['version', '--format', '{{.Client.Version}}'], { timeoutMs: 5_000 });
        if (result.code === 0) return { engine, available: true, message: `${engine} is available` };
    }
    return { available: false, message: `OCI sandbox unavailable: install ${candidates.join(' or ')}` };
}

function sandboxArgs(
    workflow: CompiledWorkflow,
    grants: WorkspaceGrant[],
    shellCommand: string,
    cwd?: string,
): string[] {
    const sandbox = workflow.config.sandbox ?? {};
    const image = sandbox.image ?? 'mindos-sandbox:v1';
    const writable = workflow.config.tasks.some(task => task.workspace_access === 'write');
    const args = [
        'run', '--rm', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--network', sandbox.network ?? 'none', '--pids-limit', String(sandbox.limits?.pids ?? 256),
        '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=256m',
        '--mount', bindMount(workflow.workspaceRoot, '/workspace', writable),
        '--workdir', containerWorkingDirectory(workflow.workspaceRoot, grants, cwd),
    ];
    if (sandbox.limits?.cpus) args.push('--cpus', String(sandbox.limits.cpus));
    if (sandbox.limits?.memory) args.push('--memory', sandbox.limits.memory);
    const stateTarget = containerPath('/workspace', path.relative(workflow.workspaceRoot, workflow.stateDir));
    if (inside(workflow.workspaceRoot, workflow.stateDir)) {
        args.push('--tmpfs', `${stateTarget}:rw,noexec,nosuid,nodev,size=16m`);
    }
    for (const grant of grants) {
        args.push('--mount', bindMount(grant.path, `/mnt/grants/${grant.id}`, grant.access === 'write'));
    }
    args.push(image, '/bin/sh', '-c', shellCommand);
    return args;
}

function containerWorkingDirectory(root: string, grants: WorkspaceGrant[], cwd?: string): string {
    if (!cwd || inside(root, cwd)) return containerPath('/workspace', cwd ? path.relative(root, cwd) : '');
    const grant = grants.find(item => inside(item.path, cwd));
    if (!grant) return '/workspace';
    return containerPath(`/mnt/grants/${grant.id}`, path.relative(grant.path, cwd));
}

function containerPath(root: string, relative: string): string {
    return path.posix.join(root, ...relative.split(path.sep).filter(Boolean));
}

function bindMount(source: string, target: string, writable: boolean): string {
    return `type=bind,src=${source},dst=${target},${writable ? 'rw' : 'ro'}`;
}

function nativeInvocation(command: string, args: string[]): { command: string; args: string[] } {
    if (process.platform !== 'win32') return { command, args };
    if (command === 'sh' && args[0] === '-c') {
        return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', args[1] ?? ''] };
    }
    return { command, args };
}

function runProcess(
    command: string,
    args: string[],
    options: { cwd?: string; timeoutMs?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv },
): Promise<NativeShellResult> {
    return new Promise(resolve => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            shell: false,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const append = (current: string, chunk: Buffer) => (current + chunk.toString()).slice(0, MAX_OUTPUT);
        child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
        child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
        const finish = (code: number | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
            resolve({ stdout, stderr, code });
        };
        const abort = () => { terminate(child.pid); finish(null); };
        const timer = setTimeout(abort, options.timeoutMs ?? 120_000);
        options.signal?.addEventListener('abort', abort, { once: true });
        child.on('close', finish);
        child.on('error', error => { stderr = error.message; finish(null); });
    });
}

function terminate(pid: number | undefined): void {
    if (!pid) return;
    try { process.kill(process.platform === 'win32' ? pid : -pid, 'SIGTERM'); } catch { /* already exited */ }
}

function safeEnvironment(): NodeJS.ProcessEnv {
    return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        !/(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE[_-]?KEY)/i.test(key)));
}

function quote(values: string[]): string {
    return values.map(value => `'${value.replace(/'/g, `'"'"'`)}'`).join(' ');
}

function inside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
