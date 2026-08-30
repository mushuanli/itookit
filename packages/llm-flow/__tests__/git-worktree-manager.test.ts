import { describe, expect, it } from 'vitest';
import { GitWorktreeFlowWorkspaceManager } from '../src/flow/git-worktree-manager';

describe('GitWorktreeFlowWorkspaceManager', () => {
    it('creates, fast-forwards and cleans an isolated worktree using argv-safe commands', async () => {
        const calls: Array<{ program: string; args: string[]; cwd: string }> = [];
        const manager = new GitWorktreeFlowWorkspaceManager({
            repository: '/repo',
            directoryFor: sessionId => `/worktrees/${sessionId}`,
            commands: {
                async run(program, args, options) {
                    calls.push({ program, args, cwd: options.cwd });
                    return { stdout: '' };
                },
            },
        });

        const lease = await manager.prepare('run with spaces', {
            mode: 'worktree', base: 'head', merge: 'auto-if-clean', cleanup: 'always',
        });
        await lease.finish('succeeded');
        await lease.finish('succeeded');

        expect(lease.directory).toBe('/worktrees/run with spaces');
        expect(calls[0].args.slice(0, 3)).toEqual(['worktree', 'add', '-b']);
        expect(calls.some(call => call.args[0] === 'merge' && call.args[1] === '--ff-only')).toBe(true);
        expect(calls.some(call => call.args.slice(0, 2).join(' ') === 'worktree remove')).toBe(true);
        expect(calls.every(call => call.program === 'git')).toBe(true);
    });

    it('refuses automatic merge when the worktree has uncommitted changes', async () => {
        const manager = new GitWorktreeFlowWorkspaceManager({
            repository: '/repo', directoryFor: () => '/worktree',
            commands: { async run(_program, args) { return { stdout: args[0] === 'status' ? ' M file.ts' : '' }; } },
        });
        const lease = await manager.prepare('run', { mode: 'worktree', merge: 'auto-if-clean', cleanup: 'always' });
        await expect(lease.finish('succeeded')).rejects.toThrow('uncommitted changes');
    });
});
