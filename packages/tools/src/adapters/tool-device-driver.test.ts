import { describe, expect, it } from 'vitest';
import { BUILTIN_TOOLS } from '../index';
import type { INativeShell } from '../core/types';
import { ToolDeviceDriver } from './tool-device-driver';

function shellSpy(calls: string[]): INativeShell {
    return {
        capabilities: { ripgrep: false, fd: false },
        async exec(command, args) {
            calls.push(`${command} ${args.join(' ')}`);
            return { stdout: 'ok', stderr: '', code: 0 };
        },
    };
}

const toolNames = (driver: ToolDeviceDriver): string[] =>
    driver.getToolDefinitions().map(definition => definition.function?.name ?? definition.name ?? '');

describe('ToolDeviceDriver.setNativeShell', () => {
    it('advertises Bash only after a native shell is injected', async () => {
        const driver = new ToolDeviceDriver([...BUILTIN_TOOLS]);
        await driver.init();
        expect(toolNames(driver)).not.toContain('Bash');

        driver.setNativeShell(shellSpy([]));
        await driver.init();
        expect(toolNames(driver)).toContain('Bash');
        expect(driver.getToolMeta('Bash')?.enabled).toBe(true);
    });

    it('runs the injected shell through the advertised tool', async () => {
        const calls: string[] = [];
        const driver = new ToolDeviceDriver([...BUILTIN_TOOLS]);
        driver.setNativeShell(shellSpy(calls));
        await driver.init();

        const result = await driver.invoke({ toolId: 'Bash', args: { command: 'echo ok' }, cwd: '/' });

        expect(calls).toEqual(['sh -c echo ok']);
        expect(result.success).toBe(true);
        expect(result.output).toContain('[exit 0]');
    });
});
