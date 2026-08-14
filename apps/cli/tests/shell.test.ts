import { describe, expect, it } from 'vitest';
import { sandboxBaseArgs } from '../src/shell';
import type { CompiledWorkflow, WorkspaceGrant } from '../src/types';

describe('sandboxBaseArgs', () => {
    it('adds -i for interactive sessions (TTY) but not for one-shot exec', () => {
        const interactive = sandboxBaseArgs(workflow(), [], '/host/workspace', true);
        const oneShot = sandboxBaseArgs(workflow(), [], '/host/workspace', false);

        expect(interactive.args[0]).toBe('run');
        expect(interactive.args[1]).toBe('-i');
        expect(oneShot.args).not.toContain('-i');
    });

    it('bind-mounts the workspace to /workspace and maps the working directory', () => {
        const { args } = sandboxBaseArgs(workflow(), [], '/host/workspace/sub', true);

        expect(pair(args, '--mount')).toBe('type=bind,src=/host/workspace,dst=/workspace,rw');
        expect(pair(args, '--workdir')).toBe('/workspace/sub');
    });

    it('mounts granted paths read-only and hides the state directory behind tmpfs', () => {
        const grant: WorkspaceGrant = { id: 'grant-1', path: '/external/data', access: 'read', createdAt: 1 };
        const { args } = sandboxBaseArgs(workflow(), [grant], '/host/workspace', true);

        expect(args).toContain('type=bind,src=/external/data,dst=/mnt/grants/grant-1,ro');
        expect(pair(args, '--tmpfs', 2)).toBe('/workspace/.mindos:rw,noexec,nosuid,nodev,size=16m');
    });

    it('enforces read-only root, no capabilities and network isolation', () => {
        const { args } = sandboxBaseArgs(workflow(), [], '/host/workspace', true);

        expect(args).toContain('--read-only');
        expect(args).toContain('--cap-drop=ALL');
        expect(pair(args, '--network')).toBe('none');
        expect(pair(args, '--pids-limit')).toBe('256');
    });

    it('forwards agent env into the container via --env and drops invalid keys', () => {
        const { args } = sandboxBaseArgs(workflow(), [], '/host/workspace', true, {
            FOO: 'bar',
            'INVALID KEY': 'x',
            '1LEADING': 'y',
        });

        expect(pair(args, '--env')).toBe('FOO=bar');
        expect(args.filter(item => item === '--env')).toHaveLength(1);
    });
});

function workflow(): CompiledWorkflow {
    return {
        config: {
            version: 1,
            name: 'test',
            goal: 'test',
            providers: [],
            connections: [],
            agents: [],
            tasks: [{ id: 'write', agent: 'a', description: 'd', workspace_access: 'write' }],
            result: { task: 'write', output: 'r' },
            sandbox: { mode: 'oci', engine: 'auto' },
        },
        workspaceRoot: '/host/workspace',
        stateDir: '/host/workspace/.mindos',
    } as unknown as CompiledWorkflow;
}

/** Return the value immediately following the flag name (or the nth occurrence). */
function pair(args: string[], flag: string, occurrence = 1): string | undefined {
    let seen = 0;
    for (let index = 0; index < args.length; index++) {
        if (args[index] === flag && ++seen === occurrence) return args[index + 1];
    }
    return undefined;
}
