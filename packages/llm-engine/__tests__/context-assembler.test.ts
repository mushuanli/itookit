import { describe, expect, it } from 'vitest';
import type { Artifact, BranchContextProfile, ContextPlan, ContextSnapshot } from '@itookit/common';
import { ContextAssembler } from '../src/core/context-assembler';

async function hash(content: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function fixture(options: { profile?: BranchContextProfile; artifact?: Artifact; tokenBudget?: number } = {}) {
    const rounds = new Map<string, any>([
        ['r1', {
            historyParentIds: [],
            input: [{ role: 'user', content: 'old question' }],
            output: [{ role: 'assistant', content: 'old answer' }],
        }],
        ['r2', {
            historyParentIds: ['r1'],
            input: [{ role: 'user', content: 'newer question' }],
            output: [{ role: 'assistant', content: 'newer answer' }],
        }],
    ]);
    const snapshots: ContextSnapshot[] = [];
    const assembler = new ContextAssembler({
        log: {} as any,
        manifest: {} as any,
        profileStore: { getProfile: async () => options.profile ?? null } as any,
        snapshotStore: {
            save: async (snapshot: ContextSnapshot) => {
                const persisted = { ...snapshot, digest: await hash(JSON.stringify(snapshot.canonicalMessages)) };
                snapshots.push(persisted);
                return persisted;
            },
        } as any,
        readRound: async id => rounds.get(id) ?? null,
        loadArtifact: async id => options.artifact?.id === id ? options.artifact : null,
        retrieveMemory: async () => [{ entryId: 'm1', namespaceId: 'agent', content: 'remember me', contentHash: 'memory-hash' }],
    });
    const plan: ContextPlan = {
        branchRef: 'main', branchHead: 'r2', profile: { id: 'p1', revision: 1 },
        pendingUserMessage: { role: 'user', content: 'pending question' }, explicitInputs: [],
        tokenBudget: options.tokenBudget,
    };
    return { assembler, plan, snapshots };
}

describe('ContextAssembler', () => {
    it('applies profile rules, memory and returns the persisted digest', async () => {
        const profile: BranchContextProfile = {
            id: 'p1', revision: 1, createdAt: 1, rules: { r1: { mode: 'exclude' } },
        };
        const { assembler, plan } = await fixture({ profile });
        const result = await assembler.assemble(plan, 'run-1', { id: 'agent', version: 'v1' }, 'system');
        expect(result.messages.map(message => message.content)).not.toContain('old question');
        expect(result.messages.map(message => message.content)).toContain('newer answer');
        expect(result.messages.some(message => String(message.content).includes('remember me'))).toBe(true);
        expect(result.messages.at(-1)).toMatchObject({ role: 'user', content: 'pending question' });
        expect(result.snapshot.digest).toMatch(/^[a-f0-9]{64}$/);
    });

    it('materializes a hash-verified artifact input', async () => {
        const content = 'upstream final answer';
        const artifact: Artifact = {
            id: 'a1',
            nodeRunId: 'upstream',
            outputName: 'final',
            type: 'final-answer', content, contentHash: await hash(content), createdAt: 1,
        };
        const { assembler, plan } = await fixture({ artifact });
        plan.explicitInputs.push({ kind: 'artifact', artifactId: 'a1', label: 'source', order: 0 });
        const result = await assembler.assemble(plan, 'run-1', { id: 'agent', version: 'v1' });
        expect(result.messages.some(message => String(message.content).includes(content))).toBe(true);
    });

    it('rejects missing or corrupt artifacts instead of hiding context damage', async () => {
        const artifact: Artifact = {
            id: 'a1',
            nodeRunId: 'upstream',
            outputName: 'final',
            type: 'final-answer', content: 'changed', contentHash: await hash('original'), createdAt: 1,
        };
        const { assembler, plan } = await fixture({ artifact });
        plan.explicitInputs.push({ kind: 'artifact', artifactId: 'a1', label: 'source', order: 0 });
        await expect(assembler.assemble(plan, 'run-1', { id: 'agent', version: 'v1' })).rejects.toThrow(/hash mismatch/);
    });

    it('truncates only at ContextBlock boundaries and preserves pending user', async () => {
        const { assembler, plan } = await fixture({ tokenBudget: 12 });
        const result = await assembler.assemble(plan, 'run-1', { id: 'agent', version: 'v1' });
        expect(result.snapshot.blocks.filter(block => block.kind === 'round')).toHaveLength(1);
        expect(result.messages.at(-1)).toMatchObject({ role: 'user', content: 'pending question' });
    });
});
