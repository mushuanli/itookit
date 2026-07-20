import type {
    AgentRunId,
    Goal,
    GoalDefinitionEdge,
    GoalDraft,
    GoalNodeDefinition,
    GoalRevision,
    GoalValidationIssue,
    InputBinding,
    RunEdge,
} from '@itookit/common';
import type { IChatEngine } from './types';
import { ulid } from './ulid';

export class GoalDraftConflictError extends Error {
    constructor(expected: number, actual: number) {
        super(`Goal draft version conflict: expected ${expected}, got ${actual}`);
        this.name = 'GoalDraftConflictError';
    }
}

export interface RemovedGoalNode {
    node: GoalNodeDefinition;
    edges: GoalDefinitionEdge[];
}

/** Versioned Goal definition CRUD, validation, persistence and instantiation. */
export class GoalDraftService {
    constructor(
        private readonly engine: IChatEngine,
        private readonly nodeId: string,
    ) {}

    createDraft(name = 'Untitled DAG', id = ulid()): GoalDraft {
        return { id, draftVersion: 0, name, nodes: [], edges: [], updatedAt: Date.now() };
    }

    async loadDraft(id: string): Promise<GoalDraft | null> {
        return this.readAsset<GoalDraft>(this.draftName(id));
    }

    async saveDraft(draft: GoalDraft, expectedVersion: number): Promise<GoalDraft> {
        const current = await this.loadDraft(draft.id);
        const actual = current?.draftVersion ?? 0;
        if (actual !== expectedVersion) throw new GoalDraftConflictError(expectedVersion, actual);

        const persisted = this.bump(draft, actual + 1);
        await this.writeAsset(this.draftName(draft.id), persisted);
        return persisted;
    }

    addNode(
        draft: GoalDraft,
        input: Partial<GoalNodeDefinition> & Pick<GoalNodeDefinition, 'agent'>,
    ): GoalDraft {
        const id = input.id ?? ulid();
        if (draft.nodes.some(node => node.id === id)) throw new Error(`Duplicate GoalNodeId: ${id}`);
        const node: GoalNodeDefinition = {
            id,
            label: input.label?.trim() || `Agent ${draft.nodes.length + 1}`,
            agent: input.agent,
            prompt: input.prompt ?? '',
            inputs: input.inputs ? [...input.inputs] : [],
            outputPorts: input.outputPorts ? [...input.outputPorts] : ['final'],
            mode: input.mode,
            joinPolicy: input.joinPolicy ?? 'all-success',
            maxRetries: input.maxRetries ?? 0,
            canParallel: input.canParallel ?? true,
            position: input.position ?? { x: 40 + draft.nodes.length * 36, y: 40 + draft.nodes.length * 28 },
        };
        return this.touch(draft, { nodes: [...draft.nodes, node] });
    }

    updateNode(draft: GoalDraft, id: string, changes: Partial<GoalNodeDefinition>): GoalDraft {
        if (changes.id && changes.id !== id) throw new Error('GoalNodeId is immutable');
        let found = false;
        const nodes = draft.nodes.map(node => {
            if (node.id !== id) return node;
            found = true;
            return { ...node, ...changes, id };
        });
        if (!found) throw new Error(`Goal node not found: ${id}`);
        return this.touch(draft, { nodes });
    }

    duplicateNode(draft: GoalDraft, id: string): GoalDraft {
        const source = draft.nodes.find(node => node.id === id);
        if (!source) throw new Error(`Goal node not found: ${id}`);
        return this.addNode(draft, {
            ...source,
            id: ulid(),
            label: `${source.label} copy`,
            position: source.position ? { x: source.position.x + 32, y: source.position.y + 32 } : undefined,
        });
    }

    removeNode(draft: GoalDraft, id: string): { draft: GoalDraft; removed: RemovedGoalNode } {
        const node = draft.nodes.find(item => item.id === id);
        if (!node) throw new Error(`Goal node not found: ${id}`);
        const edges = draft.edges.filter(edge => edge.from === id || edge.to === id);
        return {
            draft: this.touch(draft, {
                nodes: draft.nodes.filter(item => item.id !== id),
                edges: draft.edges.filter(edge => edge.from !== id && edge.to !== id),
            }),
            removed: { node, edges },
        };
    }

    addEdge(draft: GoalDraft, input: Omit<GoalDefinitionEdge, 'id'> & { id?: string }): GoalDraft {
        const edge: GoalDefinitionEdge = { ...input, id: input.id ?? ulid() };
        if (draft.edges.some(item => item.id === edge.id)) throw new Error(`Duplicate edge ID: ${edge.id}`);
        return this.touch(draft, { edges: [...draft.edges, edge] });
    }

    updateEdge(draft: GoalDraft, id: string, changes: Partial<GoalDefinitionEdge>): GoalDraft {
        if (changes.id && changes.id !== id) throw new Error('Goal edge ID is immutable');
        let found = false;
        const edges = draft.edges.map(edge => {
            if (edge.id !== id) return edge;
            found = true;
            return { ...edge, ...changes, id };
        });
        if (!found) throw new Error(`Goal edge not found: ${id}`);
        return this.touch(draft, { edges });
    }

    removeEdge(draft: GoalDraft, id: string): GoalDraft {
        if (!draft.edges.some(edge => edge.id === id)) throw new Error(`Goal edge not found: ${id}`);
        return this.touch(draft, { edges: draft.edges.filter(edge => edge.id !== id) });
    }

    validate(draft: Pick<GoalDraft, 'nodes' | 'edges'>): GoalValidationIssue[] {
        const issues: GoalValidationIssue[] = [];
        const nodes = new Map<string, GoalNodeDefinition>();
        for (const node of draft.nodes) {
            if (nodes.has(node.id)) issues.push(this.issue('duplicate-node', `Duplicate node ID: ${node.id}`, { nodeId: node.id }));
            nodes.set(node.id, node);
            if (!node.agent.id) issues.push(this.issue('missing-agent', 'Select an Agent for this node.', { nodeId: node.id }));
            if (!node.agent.version) issues.push(this.issue('missing-agent-version', 'Agent version must be frozen before Run.', { nodeId: node.id }));
        }

        const edgeKeys = new Set<string>();
        const adjacency = new Map<string, string[]>();
        for (const id of nodes.keys()) adjacency.set(id, []);
        for (const edge of draft.edges) {
            if (!nodes.has(edge.from)) issues.push(this.issue('unknown-edge-source', `Unknown edge source: ${edge.from}`, { edgeId: edge.id }));
            if (!nodes.has(edge.to)) issues.push(this.issue('unknown-edge-target', `Unknown edge target: ${edge.to}`, { edgeId: edge.id }));
            if (edge.from === edge.to) issues.push(this.issue('self-edge', 'Self edges are not allowed.', { edgeId: edge.id }));
            const key = [edge.from, edge.to, edge.kind, edge.outputPort ?? '', edge.inputPort ?? ''].join('|');
            if (edgeKeys.has(key)) issues.push(this.issue('duplicate-edge', 'Duplicate edge.', { edgeId: edge.id }));
            edgeKeys.add(key);
            if (edge.kind === 'data') {
                const source = nodes.get(edge.from);
                if (!edge.outputPort || !edge.inputPort) {
                    issues.push(this.issue('missing-data-port', 'Data edges require output and input ports.', { edgeId: edge.id }));
                } else if (source?.outputPorts && !source.outputPorts.includes(edge.outputPort)) {
                    issues.push(this.issue('unknown-output-port', `Unknown output port: ${edge.outputPort}`, { edgeId: edge.id }));
                }
            }
            if (nodes.has(edge.from) && nodes.has(edge.to) && edge.from !== edge.to) adjacency.get(edge.from)!.push(edge.to);
        }

        const visiting = new Set<string>();
        const visited = new Set<string>();
        const visit = (id: string): boolean => {
            if (visiting.has(id)) return true;
            if (visited.has(id)) return false;
            visiting.add(id);
            for (const next of adjacency.get(id) ?? []) if (visit(next)) return true;
            visiting.delete(id);
            visited.add(id);
            return false;
        };
        if ([...nodes.keys()].some(visit)) issues.push(this.issue('cycle', 'The DAG contains a dependency cycle.'));
        return issues;
    }

    async createRevision(draft: GoalDraft): Promise<GoalRevision> {
        const errors = this.validate(draft).filter(issue => issue.severity === 'error');
        if (errors.length) throw new Error(`Goal draft is invalid: ${errors.map(error => error.message).join('; ')}`);
        const revision = (draft.baseRevision ?? 0) + 1;
        const content = { name: draft.name, nodes: draft.nodes, edges: draft.edges };
        const result: GoalRevision = {
            id: draft.id,
            revision,
            ...content,
            createdAt: Date.now(),
            digest: await this.hash(content),
        };
        await this.writeAsset(this.revisionName(result.id, revision), result);
        return result;
    }

    instantiate(revision: GoalRevision): Goal {
        const nodeRuns: Record<string, AgentRunId> = {};
        for (const node of revision.nodes) nodeRuns[node.id] = ulid();
        const nodes = revision.nodes.map(node => {
            const explicitInputs = node.inputs.map(input => {
                if (input.kind !== 'upstream-output') return input as InputBinding;
                return {
                    kind: 'upstream-output' as const,
                    runId: nodeRuns[input.nodeId],
                    outputPort: input.outputPort,
                    inputLabel: input.inputLabel,
                    order: input.order,
                };
            });
            const edgeInputs: InputBinding[] = revision.edges
                .filter(edge => edge.kind === 'data' && edge.to === node.id)
                .map((edge, index) => ({
                    kind: 'upstream-output',
                    runId: nodeRuns[edge.from],
                    outputPort: edge.outputPort!,
                    inputLabel: edge.inputPort!,
                    order: edge.order ?? explicitInputs.length + index,
                }));
            return {
                id: nodeRuns[node.id],
                agent: { id: node.agent.id, version: node.agent.version! },
                prompt: node.prompt,
                mode: node.mode,
                inputs: [...explicitInputs, ...edgeInputs],
                joinPolicy: node.joinPolicy,
                maxRetries: node.maxRetries,
                canParallel: node.canParallel,
            };
        });
        const edges: RunEdge[] = revision.edges.map(edge => ({
            from: nodeRuns[edge.from], to: nodeRuns[edge.to], kind: edge.kind,
            outputPort: edge.outputPort, inputPort: edge.inputPort, order: edge.order,
        }));
        return {
            id: ulid(),
            definition: { id: revision.id, revision: revision.revision, digest: revision.digest },
            nodes,
            edges,
            nodeRuns,
        };
    }

    private touch(draft: GoalDraft, changes: Partial<GoalDraft>): GoalDraft {
        return { ...draft, ...changes, updatedAt: Date.now() };
    }

    private bump(draft: GoalDraft, draftVersion: number): GoalDraft {
        return { ...draft, draftVersion, updatedAt: Date.now() };
    }

    private issue(code: string, message: string, target: Partial<GoalValidationIssue> = {}): GoalValidationIssue {
        return { code, message, severity: 'error', ...target };
    }

    private async readAsset<T>(name: string): Promise<T | null> {
        try {
            const text = await this.engine.openFile(this.nodeId).asset(name).readText();
            return text ? JSON.parse(text) as T : null;
        } catch { return null; }
    }

    private async writeAsset(name: string, value: unknown): Promise<void> {
        await this.engine.createAsset(this.nodeId, name, JSON.stringify(value, null, 2));
    }

    private draftName(id: string): string { return `goal-draft-${id}.json`; }
    private revisionName(id: string, revision: number): string { return `goal-${id}-r${revision}.json`; }

    private async hash(value: unknown): Promise<string> {
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
}
