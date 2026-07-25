import type {
    Artifact,
    ContextExplanation,
    ContextSnapshot,
    ContextSnapshotId,
    ChatMessage,
    V3ContextPlan,
} from '@itookit/common';
import { ulid } from '../persistence/ulid';
import { digest } from './utils';

export interface TaskContextAssemblerDeps {
    branchHistory?: () => Promise<ChatMessage[]> | ChatMessage[];
    stateBlocks?: () => Promise<string[]> | string[];
    retrieveMemory?: () => Promise<Array<{ source: string; content: string; priority?: number; required?: boolean }>> | Array<{ source: string; content: string; priority?: number; required?: boolean }>;
    readArtifact: (id: string) => Promise<Artifact | null>;
    saveSnapshot?: (snapshot: ContextSnapshot) => Promise<ContextSnapshot>;
    agentSystemPrompt?: string;
    skillsPrompt?: string;
}

export interface TaskContextAssemblyResult {
    snapshot: ContextSnapshot;
    explanation: ContextExplanation;
}

/** Context assembler for AgentTask only. Other task kinds use resolved input digests. */
export class TaskContextAssembler {
    constructor(private readonly deps: TaskContextAssemblerDeps) {}

    async assemble(plan: V3ContextPlan, options: { persist?: boolean } = {}): Promise<TaskContextAssemblyResult> {
        const included: Array<{ source: string; content: string; priority: number; required: boolean; kind: 'system' | 'history' | 'state' | 'memory' | 'artifact' | 'pending' }> = [];
        const add = (source: string, content: string, kind: typeof included[number]['kind'], priority: number, required: boolean): void => {
            included.push({ source, content, kind, priority, required });
        };
        if (this.deps.agentSystemPrompt) add('agent:system', this.deps.agentSystemPrompt, 'system', 100, true);
        if (this.deps.skillsPrompt) add('skills', this.deps.skillsPrompt, 'system', 90, false);
        for (const message of await this.deps.branchHistory?.() ?? []) add('conversation', messageText(message), 'history', 20, false);
        for (const block of await this.deps.stateBlocks?.() ?? []) add('agent-state', block, 'state', 60, false);
        for (const memory of await this.deps.retrieveMemory?.() ?? []) add(memory.source, memory.content, 'memory', memory.priority ?? 40, memory.required ?? false);

        const inputPorts = [...plan.resolvedInputs].sort((a, b) => a.port.order - b.port.order);
        for (const input of inputPorts) {
            const ids = [...input.artifacts].sort((a, b) => String(a).localeCompare(String(b)));
            for (const id of ids) {
                const artifact = await this.deps.readArtifact(String(id));
                if (!artifact) throw new Error(`Context Artifact not found: ${id}`);
                add(`artifact:${id}`, artifactText(artifact), 'artifact', 50, input.port.required);
            }
        }
        if (plan.pendingUserMessage) add('pending:user', messageText(plan.pendingUserMessage), 'pending', 80, true);

        const tokenBudget = plan.tokenPolicy.maxTokens;
        const kept = fitBudget(included, tokenBudget);
        const excluded = included.filter(item => !kept.includes(item));
        const blocks = kept.map(item => ({ kind: 'system' as const, source: 'runtime' as const, content: `${item.source}:\n${item.content}` }));
        const canonicalMessages = kept.map(item => ({ role: item.kind === 'pending' ? 'user' as const : 'system' as const, content: `${item.source}:\n${item.content}` }));
        const tokenCount = estimate(canonicalMessages);
        const explanation: ContextExplanation = {
            included: kept.map(item => decision(item)),
            excluded: excluded.map(item => ({ ...decision(item), reason: 'token budget or lower priority' })),
            summarized: [],
            tokenCount,
            digest: digest(canonicalMessages),
        };
        const snapshot: ContextSnapshot = {
            id: ulid() as ContextSnapshotId,
            taskRunId: plan.taskRunId,
            createdAt: Date.now(),
            branchRef: plan.conversation?.branchRef ?? 'isolated',
            branchHead: plan.conversation?.branchHead ?? null,
            profile: plan.conversation?.profile ?? { id: 'isolated', revision: 0 },
            agent: { id: String(plan.agent.id), version: plan.agent.version },
            blocks,
            canonicalMessages,
            tokenCount,
            digest: explanation.digest,
            explanation,
        };
        const persisted = options.persist === false || !this.deps.saveSnapshot ? snapshot : await this.deps.saveSnapshot(snapshot);
        return { snapshot: persisted, explanation };
    }
}

function fitBudget<T extends { content: string; required: boolean; priority: number }>(items: T[], budget?: number): T[] {
    if (!budget || budget < 1) return [...items];
    const kept = [...items];
    while (estimate(kept.map(item => ({ role: 'system' as const, content: item.content }))) > budget) {
        const candidate = kept.filter(item => !item.required).sort((a, b) => a.priority - b.priority)[0];
        if (!candidate) break;
        kept.splice(kept.indexOf(candidate), 1);
    }
    return kept;
}

function decision(item: { source: string; content: string; priority: number; required: boolean }): ContextExplanation['included'][number] {
    return { source: item.source, reason: 'selected by TaskContextPolicy', priority: item.priority, required: item.required, tokenCount: Math.ceil(item.content.length / 4) };
}

function messageText(message: ChatMessage): string { return typeof message.content === 'string' ? message.content : JSON.stringify(message.content); }
function artifactText(artifact: Artifact): string { return typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content); }
function estimate(messages: ChatMessage[]): number { return Math.ceil(messages.reduce((sum, message) => sum + messageText(message).length, 0) / 4); }
