import { describe, expect, it } from 'vitest';
import { MemoryBackend } from '@itookit/vfs-core';
import { createApplicationRuntime } from '../src/runtime/create-application-runtime';

describe('host application startup', () => {
    it('starts without browser globals and disposes its owned filesystem', async () => {
        const progress: string[] = [];
        const runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'cli', onProgress: message => progress.push(message) });
        try {
            expect(progress).toContain('初始化核心服务…');
            expect(await runtime.agentService.getConnections()).not.toHaveLength(0);
        } finally {
            await runtime.dispose();
        }
        await expect(runtime.vfs.openFileSystem('/')).rejects.toThrow();
    });
});
