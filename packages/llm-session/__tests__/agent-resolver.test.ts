import { describe, it, expect, afterEach } from 'vitest';
import { AgentResolver } from '../src/session/agent-resolver';

const connection = {
    id: 'default', name: 'Default', providerId: 'p1', protocol: 'openai', model: 'm1',
} as never;

const agentDefinition = {
    id: 'default', name: 'Default Assistant', type: 'agent',
    config: { connectionId: 'default', modelName: '' },
} as never;

function service(overrides: Record<string, unknown> = {}): never {
    return {
        getAgentConfig: async (id: string) => (id === 'default' ? agentDefinition : null),
        getConnection: async () => connection,
        getDefaultConnection: async () => connection,
        getProvider: () => undefined,
        getAgents: async () => [],
        listAgents: () => [{ id: 'default' }],
        getSkills: async () => [],
        getSystemPrompt: async () => null,
        ...overrides,
    } as never;
}

describe('AgentResolver agentVersion', () => {
    afterEach(() => {
        // `subtle` lives on Crypto.prototype; drop the shadowing own property.
        delete (globalThis.crypto as { subtle?: unknown }).subtle;
    });

    it('hashes the definition when crypto.subtle is unavailable (insecure context)', async () => {
        Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });

        const resolver = new AgentResolver(service());
        const config = await resolver.resolveForChat('default');

        expect(config.agentVersion).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces a stable version for the same definition', async () => {
        const resolver = new AgentResolver(service());
        const first = await resolver.resolveForChat('default');
        const second = await resolver.resolveForChat('default');

        expect(first.agentVersion).toBe(second.agentVersion);
    });

    it('falls back without an agentVersion for an unknown agent id', async () => {
        const resolver = new AgentResolver(service());
        const config = await resolver.resolveForChat('missing');

        expect(config.id).toBe('default');
        expect(config.agentVersion).toBeUndefined();
    });
});
