import { readFile } from 'node:fs/promises';
import type { FlowDraft, FlowRevision } from '@itookit/common';
import { flowRevisionDigest } from '@itookit/llm-flow';

/** Load a `.flow` draft or revision and normalize it to an immutable FlowRevision. */
export async function loadFlowDefinition(file: string): Promise<FlowRevision> {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    if (typeof raw.draftVersion === 'number') {
        const draft = raw as unknown as FlowDraft;
        const withoutDigest = {
            id: draft.id,
            revision: draft.draftVersion,
            name: draft.name,
            nodes: structuredClone(draft.nodes),
            edges: structuredClone(draft.edges),
            parameters: structuredClone(draft.parameters ?? []),
            connections: structuredClone(draft.connections ?? []),
            defaultConnection: draft.defaultConnection,
            systemPrompt: structuredClone(draft.systemPrompt ?? []),
            toolIds: structuredClone(draft.toolIds ?? []),
            defaults: structuredClone(draft.defaults),
            runPolicy: structuredClone(draft.runPolicy),
            createdAt: draft.updatedAt ?? Date.now(),
        };
        return { ...withoutDigest, digest: flowRevisionDigest(withoutDigest) } as FlowRevision;
    }
    const revision = raw as unknown as FlowRevision;
    if (typeof revision.id !== 'string' || typeof revision.revision !== 'number' || !Array.isArray(revision.nodes) || !Array.isArray(revision.edges)) {
        throw new Error('Invalid .flow file: expected FlowDraft or FlowRevision JSON');
    }
    return {
        ...revision,
        digest: revision.digest || flowRevisionDigest(revision as Omit<FlowRevision, 'digest'>),
    };
}
