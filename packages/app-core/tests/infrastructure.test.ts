import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryBackend } from '@itookit/vfs-core';
import { LLMDeviceDriver } from '@itookit/device-llm';
import { createInfrastructure } from '../src/runtime/infrastructure';

afterEach(() => vi.restoreAllMocks());

describe('application infrastructure ownership', () => {
    it('returns initialized layout and devices with explicit cleanup ownership', async () => {
        const close = vi.fn();
        const infrastructure = await createInfrastructure({
            backend: new MemoryBackend(),
            additionalMounts: [{ path: '/extra', backend: new MemoryBackend() }],
            codexTransport: { close },
        });
        try {
            expect(infrastructure.vfs.devices.isFrozen()).toBe(true);
            for (const path of ['/run', '/extra', '/home/admin/chats', '/home/admin/.config']) {
                expect(await infrastructure.systemFS.driver.getNode(path)).not.toBeNull();
            }
            infrastructure.logIO('test');
            expect(infrastructure.vfs.ioStats.stat).toBe(0);
            expect(close).not.toHaveBeenCalled();
        } finally {
            await infrastructure.closeCodexTransport?.();
            await infrastructure.vfs.dispose();
        }
        expect(close).toHaveBeenCalledOnce();
    });

    it.each(['init', 'createDeviceNodes'] as const)('releases acquired resources when %s fails', async method => {
        const failure = new Error('device initialization failed');
        vi.spyOn(LLMDeviceDriver.prototype, method).mockRejectedValueOnce(failure);
        const backend = new MemoryBackend();
        const closed = vi.spyOn(backend, 'close');
        const close = vi.fn();
        await expect(createInfrastructure({ backend, codexTransport: { close } })).rejects.toBe(failure);
        expect(close).toHaveBeenCalledOnce();
        expect(closed).toHaveBeenCalledOnce();
    });

    it('still disposes the VFS and preserves both errors when transport cleanup fails', async () => {
        const failure = new Error('device initialization failed');
        const cleanupFailure = new Error('transport cleanup failed');
        vi.spyOn(LLMDeviceDriver.prototype, 'init').mockRejectedValueOnce(failure);
        const backend = new MemoryBackend();
        const closed = vi.spyOn(backend, 'close');
        const close = vi.fn().mockRejectedValue(cleanupFailure);
        await expect(createInfrastructure({ backend, codexTransport: { close } })).rejects.toMatchObject({
            errors: [failure, cleanupFailure],
        });
        expect(closed).toHaveBeenCalledOnce();
    });
});
