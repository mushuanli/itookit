import { describe, expect, it, vi } from 'vitest';
import { MemoryBackend } from '@itookit/vfs-core';
import { createApplicationRuntime } from '../src/runtime/create-application-runtime';
import { createInfrastructure } from '../src/runtime/infrastructure';
import type { ApplicationPlatformServices } from '../src/runtime/create-application-runtime';

describe('application infrastructure', () => {
    it('provides the VFS layout and a frozen LLM device, and closes the injected transport', async () => {
        const close = vi.fn();
        const extra = new MemoryBackend();
        const infrastructure = await createInfrastructure({
            backend: new MemoryBackend(),
            additionalMounts: [{ path: '/extra', backend: extra }],
            codexTransport: { close },
        });
        try {
            expect(infrastructure.vfs.devices.isFrozen()).toBe(true);
            // The scratch mount and host mounts are both reachable from the root view.
            for (const path of ['/run', '/extra', '/home/admin/chats', '/home/admin/.config']) {
                expect(await infrastructure.systemFS.driver.getNode(path)).not.toBeNull();
            }
            expect(infrastructure.llmDriver).toBeDefined();
            // `logIO` reports and resets the public counters.
            infrastructure.logIO('test');
            expect(infrastructure.vfs.ioStats.stat).toBe(0);
            await infrastructure.closeCodexTransport?.();
            expect(close).toHaveBeenCalledOnce();
        } finally {
            await infrastructure.vfs.dispose();
        }
    });
});

describe('host application startup', () => {
    it('closes the kernel when the host recovery hook rejects startup', async () => {
        const closed = vi.fn(), recovered = vi.fn();
        await expect(createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'cli',
            kernelPlatform: {
                configure: headless => {
                    vi.spyOn(headless.kernel, 'listSessions').mockImplementation(async function* () { yield { id: 'free' } as never; });
                    vi.spyOn(headless.kernel, 'recoverSession').mockImplementation(recovered);
                    const dispose = headless.dispose.bind(headless);
                    vi.spyOn(headless, 'dispose').mockImplementation(async () => { closed(); await dispose(); });
                },
                beforeSessionRecovery: async () => { throw new Error('workspace recovery refused'); },
            },
        })).rejects.toThrow('workspace recovery refused');
        expect(recovered).not.toHaveBeenCalled();
        expect(closed).toHaveBeenCalledTimes(1);
    });

    it('awaits host binding with initialized file services before starting Session recovery', async () => {
        let bound: ApplicationPlatformServices | undefined;
        let bindingComplete = false;
        const recovered = vi.fn();
        const runtime = await createApplicationRuntime({ backend: new MemoryBackend(), ownerKind: 'cli',
            kernelPlatform: { configure: async (headless, services) => {
                bound = services;
                expect(await services.directoryMounts.processMounts('unconfigured')).toEqual([]);
                const list = headless.kernel.listSessions.bind(headless.kernel);
                vi.spyOn(headless.kernel, 'listSessions').mockImplementation(async function* () {
                    expect(bindingComplete).toBe(true);
                    recovered();
                    yield* list();
                });
                await Promise.resolve();
                bindingComplete = true;
            } },
        });
        try {
            expect(recovered).toHaveBeenCalled();
            expect(bound?.sessionFiles).toBe(runtime.sessionFiles);
            expect(bound?.directoryMounts).toBe(runtime.directoryMounts);
        } finally { await runtime.dispose(); }
    });

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
