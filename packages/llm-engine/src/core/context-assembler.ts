// @file: llm-engine/src/core/context-assembler.ts
// ContextAssembler — fixed 13-step pipeline that builds a ContextSnapshot.
//
// Phase 2 (WP-03): Replaces the ad-hoc buildFoldPrependLog + log.fold()
// approach with a deterministic, auditable pipeline. Each ContextSnapshot
// captures exactly what an AgentRun saw, making LLM input reproducible.
//
// Pipeline steps:
//   1. Collect mainline Rounds along parents[0] from branchHead
//   2. Read BranchContextProfile revision
//   3. Apply default context mode + branch override per round
//   4. Keep each Round.payload as an atomic protocol group
//   5. Replace summary rules with stored Summary Artifacts
//   6. Attach explicit InputBindings in order
//   7. Retrieve memory entries (placeholder until Phase 3)
//   8. Prepend system blocks (agent prompt, skills, runtime)
//   9. Append pending user message
//  10. Token budget / auto-compression at ContextBlock boundaries
//  11. ProviderMessageAdapter final validation
//  12. Persist ContextSnapshot
//  13. Return canonical messages for Loop consumption

import type {
    RoundId,
    ChatMessage,
    ContextPlan,
    ContextBlock,
    ContextSnapshot,
    ContextSnapshotId,
} from '@itookit/common';
import type { ILog } from '@itookit/common';
import type { RoundManifest } from '../persistence/round-types';
import type { ContextProfileStore } from '../persistence/context-profile-store';
import type { ContextSnapshotStore } from '../persistence/context-snapshot-store';
import { ulid } from '../persistence/ulid';

// ─── Dependencies (injected) ───────────────────────────────────────────────

export interface ContextAssemblerDeps {
    log: ILog;
    manifest: RoundManifest;
    profileStore: ContextProfileStore;
    snapshotStore: ContextSnapshotStore;
    /** Read a single round by id. Injected from RoundLog. */
    readRound: (roundId: RoundId) => Promise<{ payload: ChatMessage[]; parents: RoundId[]; meta?: { defaultContextMode?: 'include' | 'exclude' }; _deleted?: boolean } | null>;
}

// ─── Result ────────────────────────────────────────────────────────────────

export interface AssemblyResult {
    snapshot: ContextSnapshot;
    messages: ChatMessage[];
}

// ─── ContextAssembler ──────────────────────────────────────────────────────

export class ContextAssembler {
    constructor(private readonly deps: ContextAssemblerDeps) {}

    /**
     * Execute the full assembly pipeline for a given plan.
     */
    async assemble(
        plan: ContextPlan,
        runId: string,
        agent: { id: string; version: string },
        systemPrompt?: string,
        skillsPrompt?: string,
    ): Promise<AssemblyResult> {
        const blocks: ContextBlock[] = [];

        // ── Step 1-2: Collect mainline Rounds + read profile ────────────
        const mainlineRounds = await this.collectMainline(plan.branchHead);
        const profile = plan.profile.id
            ? await this.deps.profileStore.getProfile(plan.profile.id, plan.profile.revision)
            : null;

        // ── Step 3-4: Apply context rules, keep protocol groups atomic ──
        for (const { roundId, payload, defaultContextMode } of mainlineRounds) {
            const rule = profile?.rules[roundId];
            if (rule?.mode === 'exclude' || (!rule && defaultContextMode === 'exclude')) continue;

            if (rule?.mode === 'summary') {
                // ── Step 5: Summary — replace with stored Artifact ──────
                blocks.push({
                    kind: 'summary',
                    sourceRoundIds: [roundId],
                    artifactId: rule.artifactId,
                });
            } else {
                blocks.push({ kind: 'round', roundId, messages: [...payload] });
            }
        }

        // ── Step 6: Attach InputBindings ───────────────────────────────
        for (const binding of (plan.explicitInputs ?? []).sort((a, b) => a.order - b.order)) {
            if (binding.kind === 'artifact') {
                blocks.push({ kind: 'artifact', artifactId: binding.artifactId, label: binding.label });
            } else if (binding.kind === 'round') {
                const roundData = mainlineRounds.find(r => r.roundId === binding.roundId);
                if (roundData) {
                    blocks.push({ kind: 'round', roundId: binding.roundId, messages: [...roundData.payload] });
                }
            } else if (binding.kind === 'text') {
                blocks.push({ kind: 'system', source: 'runtime', content: binding.content });
            }
        }

        // ── Step 7: Memory retrieval (placeholder — Phase 3) ───────────

        // ── Step 8: System blocks ──────────────────────────────────────
        if (systemPrompt) {
            blocks.unshift({ kind: 'system', source: 'agent', content: systemPrompt });
        }
        if (skillsPrompt) {
            blocks.unshift({ kind: 'system', source: 'skill', content: skillsPrompt });
        }

        // ── Step 9: Pending user message ───────────────────────────────
        blocks.push({
            kind: 'round',
            roundId: '' as RoundId,
            messages: [plan.pendingUserMessage],
        });

        // ── Step 10: Token budget & compression (placeholder — Phase 3) ──
        const canonicalMessages = this.flattenBlocks(blocks);
        const tokenCount = this.estimateTokens(canonicalMessages);

        // ── Step 12: Persist ContextSnapshot ───────────────────────────
        const snapshot: ContextSnapshot = {
            id: ulid() as ContextSnapshotId,
            runId,
            createdAt: Date.now(),
            branchRef: plan.branchRef,
            branchHead: plan.branchHead,
            profile: plan.profile,
            agent,
            blocks,
            canonicalMessages,
            tokenCount,
            digest: '',
        };

        await this.deps.snapshotStore.save(snapshot);

        return { snapshot, messages: canonicalMessages };
    }

    // ── Private helpers ──────────────────────────────────────────────────

    /** Walk parents[0] chain from head, collecting non-deleted rounds. */
    private async collectMainline(
        branchHead: RoundId | null,
    ): Promise<Array<{ roundId: RoundId; payload: ChatMessage[]; defaultContextMode?: 'include' | 'exclude' }>> {
        if (!branchHead) return [];

        const result: Array<{ roundId: RoundId; payload: ChatMessage[]; defaultContextMode?: 'include' | 'exclude' }> = [];
        let current: RoundId | undefined = branchHead;
        const visited = new Set<RoundId>();

        while (current && !visited.has(current)) {
            visited.add(current);
            const round = await this.deps.readRound(current);
            if (round && !round._deleted) {
                result.unshift({ roundId: current, payload: [...round.payload], defaultContextMode: round.meta?.defaultContextMode });
                current = round.parents?.[0];
            } else {
                current = round?.parents?.[0];
            }
        }

        return result;
    }

    private flattenBlocks(blocks: ContextBlock[]): ChatMessage[] {
        const messages: ChatMessage[] = [];
        for (const block of blocks) {
            if (block.kind === 'round') {
                messages.push(...block.messages);
            } else if (block.kind === 'system') {
                messages.push({ role: 'system', content: block.content });
            }
        }
        return messages;
    }

    private estimateTokens(messages: ChatMessage[]): number {
        let chars = 0;
        for (const msg of messages) {
            chars += typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length;
        }
        return Math.ceil(chars / 4);
    }
}
