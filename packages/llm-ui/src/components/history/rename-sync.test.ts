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

        const title = await service.getSessionTitle('/new.chat', 'New');

        expect(title).toBe('Old');
        expect(updateManifest).not.toHaveBeenCalled();
    });
});
