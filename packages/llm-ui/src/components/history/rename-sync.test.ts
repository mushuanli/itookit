import { describe, expect, it, vi } from 'vitest';
import { SessionService } from '../../services/SessionService';

describe('LLM rename synchronization', () => {
    it('uses the stored Session title without modifying it on load', async () => {
        const updateManifest = vi.fn(async () => {});
        const service = Object.create(SessionService.prototype) as any;
        service.engine = {
            getManifest: vi.fn(async () => ({ title: 'Old' })),
            updateManifest,
        };

        service.commands = { execute: vi.fn(async () => ({ sessionId: 'session', sessions: [] })) };
        const { title } = await service.loadSession('session', 'New');

        expect(title).toBe('Old');
        expect(updateManifest).not.toHaveBeenCalled();
    });
});
