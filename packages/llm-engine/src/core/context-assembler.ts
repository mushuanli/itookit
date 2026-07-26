import type {
    Artifact,
    ChatMessage,
    ContextBlock,
    ContextPlan,
    BranchContextProfile,
    ContextSnapshot,
    ContextSnapshotId,
    ContextExplanation,
    RoundId,
} from '@itookit/common';
import { generateUUID, type ILog } from '@itookit/common';
import { ProviderMessageAdapter, type ProviderKind } from './provider-message-adapter';

export interface RetrievedMemoryEntry {
    entryId: string;
    namespaceId: string;
    content: string;
    contentHash: string;
}

export interface ContextAssemblerDeps {
    log: ILog;
    profileStore: {
        getProfile(
            profileId: string,
            revision?: number,
        ): Promise<BranchContextProfile | null>;
    };
    snapshotStore?: { save(snapshot: ContextSnapshot): Promise<ContextSnapshot> };
    readRound: (roundId: RoundId) => Promise<{
        input: ChatMessage[];
        output: ChatMessage[];
        historyParentIds: RoundId[];
        defaultContextMode?: 'include' | 'exclude';
        _deleted?: boolean;
    } | null>;
    loadArtifact?: (artifactId: string) => Promise<Artifact | null>;
    retrieveMemory?: (
        plan: ContextPlan,
        agent: { id: string; version: string },
    ) => Promise<RetrievedMemoryEntry[]>;
    providerAdapter?: ProviderMessageAdapter;
    provider?: ProviderKind;
}

export interface AssemblyResult {
    snapshot: ContextSnapshot;
    messages: ChatMessage[];
}

/** Deterministic, auditable ContextPlan -> ContextSnapshot pipeline. */
export class ContextAssembler {
    constructor(private readonly deps: ContextAssemblerDeps) {}

    async assemble(
        plan: ContextPlan,
        taskRunId: string,
        agent: { id: string; version: string },
        systemPrompt?: string,
        skillsPrompt?: string,
        options: { persist?: boolean } = {},
    ): Promise<AssemblyResult> {
        let blocks: ContextBlock[] = [];
        const historyBlocks: ContextBlock[] = [];
        const inputBlocks: ContextBlock[] = [];
        const memoryBlocks: ContextBlock[] = [];
        const mainlineRounds = await this.collectMainline(plan.branchHead);
        const profile = plan.profile.id
            ? await this.deps.profileStore.getProfile(plan.profile.id, plan.profile.revision)
            : null;

        for (const { roundId, messages, defaultContextMode } of mainlineRounds) {
            const rule = profile?.rules[roundId];
            if (rule?.mode === 'exclude' || (!rule && defaultContextMode === 'exclude')) continue;
            if (rule?.mode === 'summary') {
                await this.requireArtifact(rule.artifactId);
                historyBlocks.push({ kind: 'summary', sourceRoundIds: [roundId], artifactId: rule.artifactId });
            } else {
                historyBlocks.push({ kind: 'round', roundId, messages: [...messages] });
            }
        }

        const explicitInputs = [...(plan.explicitInputs ?? [])].sort((a, b) => a.order - b.order);
        for (const binding of explicitInputs) {
            if (binding.kind === 'artifact') {
                await this.requireArtifact(binding.artifactId);
                inputBlocks.push({ kind: 'artifact', artifactId: binding.artifactId, label: binding.label });
            } else if (binding.kind === 'round') {
                const round = await this.deps.readRound(binding.roundId);
                if (!round || round._deleted) throw new Error(`Context round not found: ${binding.roundId}`);
                inputBlocks.push({
                    kind: 'round',
                    roundId: binding.roundId,
                    messages: [...round.input, ...round.output],
                });
            } else if (binding.kind === 'text') {
                inputBlocks.push({ kind: 'system', source: 'runtime', content: `${binding.label}:\n${binding.content}` });
            }
            // Upstream outputs are resolved into artifact bindings by the DAG scheduler.
        }

        for (const memory of await this.deps.retrieveMemory?.(plan, agent) ?? []) {
            memoryBlocks.push({ kind: 'memory', ...memory });
        }

        if (systemPrompt) blocks.push({ kind: 'system', source: 'agent', content: systemPrompt });
        if (skillsPrompt) blocks.push({ kind: 'system', source: 'skill', content: skillsPrompt });
        blocks.push(...historyBlocks, ...memoryBlocks, ...inputBlocks);

        // The pending message is a block so it can never be separated from final validation.
        blocks.push({ kind: 'round', roundId: '' as RoundId, messages: [plan.pendingUserMessage] });
        blocks = await this.fitTokenBudget(blocks, plan.tokenBudget);

        let canonicalMessages = await this.flattenBlocks(blocks);
        canonicalMessages = (this.deps.providerAdapter ?? new ProviderMessageAdapter()).validate(
            canonicalMessages,
            { provider: this.deps.provider ?? 'generic' },
        );
        const tokenCount = this.estimateTokens(canonicalMessages);
        const snapshot: ContextSnapshot = {
            id: generateUUID() as ContextSnapshotId,
            taskRunId,
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
        snapshot.explanation = this.explain(blocks, tokenCount);
        const persisted = options.persist === false
            ? { ...snapshot, digest: await this.sha256(JSON.stringify(snapshot.canonicalMessages)) }
            : this.deps.snapshotStore
                ? await this.deps.snapshotStore.save(snapshot)
                : (() => { throw new Error('Context snapshot persistence is not configured'); })();
        if (persisted.explanation) persisted.explanation.digest = persisted.digest;
        return { snapshot: persisted, messages: persisted.canonicalMessages };
    }

    private async collectMainline(branchHead: RoundId | null): Promise<Array<{
        roundId: RoundId;
        messages: ChatMessage[];
        defaultContextMode?: 'include' | 'exclude';
    }>> {
        const result: Array<{
            roundId: RoundId;
            messages: ChatMessage[];
            defaultContextMode?: 'include' | 'exclude';
        }> = [];
        let current: RoundId | undefined = branchHead ?? undefined;
        const visited = new Set<RoundId>();
        while (current) {
            if (visited.has(current)) throw new Error(`Conversation lineage cycle at ${current}`);
            visited.add(current);
            const round = await this.deps.readRound(current);
            if (!round) throw new Error(`Conversation round not found: ${current}`);
            if (!round._deleted) {
                result.unshift({
                    roundId: current,
                    messages: [...round.input, ...round.output],
                    defaultContextMode: round.defaultContextMode,
                });
            }
            current = round.historyParentIds[0];
        }
        return result;
    }

    private async flattenBlocks(blocks: ContextBlock[]): Promise<ChatMessage[]> {
        const messages: ChatMessage[] = [];
        for (const block of blocks) {
            if (block.kind === 'round') {
                messages.push(...block.messages);
            } else if (block.kind === 'system') {
                messages.push({ role: 'system', content: block.content });
            } else if (block.kind === 'summary' || block.kind === 'artifact') {
                const artifact = await this.requireArtifact(block.artifactId);
                const label = block.kind === 'summary' ? 'Conversation summary' : block.label;
                messages.push({ role: 'system', content: `${label}:\n${this.artifactText(artifact)}` });
            } else if (block.kind === 'memory') {
                messages.push({
                    role: 'system',
                    content: `Memory (${block.namespaceId}/${block.entryId}):\n${block.content ?? ''}`,
                });
            }
        }
        return messages;
    }

    private async fitTokenBudget(blocks: ContextBlock[], tokenBudget?: number): Promise<ContextBlock[]> {
        if (!tokenBudget || tokenBudget < 1) return blocks;
        const kept = [...blocks];
        while (kept.length > 1 && this.estimateTokens(await this.flattenBlocks(kept)) > tokenBudget) {
            // Preserve policy/system blocks and the final pending-user block.
            const index = kept.findIndex((block, i) => block.kind !== 'system' && i !== kept.length - 1);
            if (index < 0) break;
            kept.splice(index, 1);
        }
        return kept;
    }

    private async requireArtifact(artifactId: string): Promise<Artifact> {
        const artifact = await this.deps.loadArtifact?.(artifactId) ?? null;
        if (!artifact) throw new Error(`Context artifact not found: ${artifactId}`);
        const actual = await this.sha256(this.artifactText(artifact));
        if (artifact.contentHash && actual !== artifact.contentHash) {
            throw new Error(`Context artifact hash mismatch: ${artifactId}`);
        }
        return artifact;
    }

    private artifactText(artifact: Artifact): string {
        return typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content);
    }

    private estimateTokens(messages: ChatMessage[]): number {
        return Math.ceil(messages.reduce((chars, message) => {
            const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
            return chars + content.length;
        }, 0) / 4);
    }

    private explain(blocks: ContextBlock[], tokenCount: number): ContextExplanation {
        const included = blocks.filter(block => block.kind !== 'summary').map(block => ({
            source: block.kind === 'round' ? `round:${block.roundId}` : block.kind === 'artifact' ? `artifact:${block.artifactId}` : block.kind,
            reason: 'selected by branch/context policy', priority: block.kind === 'system' ? 100 : 50,
            required: block.kind === 'system', tokenCount: Math.ceil(JSON.stringify(block).length / 4),
        }));
        const summarized = blocks.filter(block => block.kind === 'summary').map(block => ({
            source: `round:${block.sourceRoundIds.join(',')}`, reason: 'summary rule', priority: 40, required: false,
            tokenCount: 0,
        }));
        return { included, excluded: [], summarized, tokenCount, digest: '' };
    }

    private async sha256(input: string): Promise<string> {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
        return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
}
