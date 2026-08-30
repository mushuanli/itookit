import type { FlowWorkspacePolicy } from '@itookit/common';
import type { FlowWorkspaceLease, FlowWorkspaceManager } from './executor';

export interface WorkspaceCommandRunner {
    run(program: string, args: string[], options: { cwd: string }): Promise<{ stdout?: string }>;
}

export interface GitWorktreeManagerOptions {
    repository: string;
    directoryFor(sessionId: string): string;
    commands: WorkspaceCommandRunner;
}

/**
 * Host-neutral Git worktree implementation. Commands are argv arrays (never a
 * shell string), so the desktop/CLI host can apply its normal sandbox policy.
 */
export class GitWorktreeFlowWorkspaceManager implements FlowWorkspaceManager {
    constructor(private readonly options: GitWorktreeManagerOptions) {}

    async prepare(sessionId: string, policy: FlowWorkspacePolicy): Promise<FlowWorkspaceLease> {
        if (policy.mode !== 'worktree') {
            throw new Error(`Git worktree manager does not implement workspace mode ${policy.mode}`);
        }
        const directory = this.options.directoryFor(sessionId);
        const branch = `flow/${safeName(sessionId)}-${Date.now().toString(36)}`;
        const base = policy.base === 'current' || policy.base === 'head' || policy.base === undefined ? 'HEAD' : policy.base;
        await this.git(['worktree', 'add', '-b', branch, directory, base]);
        let finished = false;
        return {
            directory,
            finish: async status => {
                if (finished) return;
                const merge = policy.merge ?? 'manual';
                if (status === 'succeeded' && merge === 'auto-if-clean') {
                    const state = await this.options.commands.run('git', ['status', '--porcelain'], { cwd: directory });
                    if (state.stdout?.trim()) throw new Error('Worktree has uncommitted changes; automatic merge was refused');
                    await this.git(['merge', '--ff-only', branch]);
                }
                const cleanup = policy.cleanup ?? 'on-success';
                if (cleanup === 'keep' || (cleanup === 'on-success' && status !== 'succeeded')) {
                    finished = true;
                    return;
                }
                await this.git(['worktree', 'remove', ...(status === 'succeeded' ? [] : ['--force']), directory]);
                if (merge === 'discard' || merge === 'auto-if-clean') {
                    await this.git(['branch', '-D', branch]);
                }
                finished = true;
            },
        };
    }

    private async git(args: string[]): Promise<void> {
        await this.options.commands.run('git', args, { cwd: this.options.repository });
    }
}

function safeName(value: string): string {
    return value.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 48) || 'run';
}
