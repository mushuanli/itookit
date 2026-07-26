import type { DagPluginCatalog, FlowDraft, FlowRevision } from '@itookit/common';
import { flowRevisionDigest, validateFlowRevision } from '../flow/validation';
import type { IChatEngine } from './types';

export class FlowDraftVersionConflictError extends Error {
    constructor(
        readonly flowId: string,
        readonly expectedVersion: number,
        readonly actualVersion: number,
    ) {
        super(`Flow draft ${flowId} version conflict: expected ${expectedVersion}, actual ${actualVersion}`);
        this.name = 'FlowDraftVersionConflictError';
    }
}

/** Immutable Flow revision persistence with an explicit latest pointer. */
export class FlowDefinitionStore {
    constructor(
        private readonly engine: IChatEngine,
        private readonly nodeId: string,
        private readonly plugins?: DagPluginCatalog,
    ) {}

    /** v3 draft plane: drafts are mutable and are never used as run input. */
    async createDraft(input: { id: string; name: string }): Promise<FlowDraft> {
        assertFlowId(input.id);
        if (!input.name.trim()) throw new Error('Flow name is required');
        const existing = await this.loadDraft(input.id);
        if (existing) throw new Error(`Flow draft already exists: ${input.id}`);
        const draft: FlowDraft = {
            id: input.id as FlowDraft['id'],
            draftVersion: 1,
            name: input.name.trim(),
            nodes: [],
            edges: [],
            layout: {},
            updatedAt: Date.now(),
        };
        await this.write(this.draftName(input.id), draft);
        return draft;
    }

    async listDrafts(): Promise<FlowDraft[]> {
        const assets = await this.engine.getAssets(this.nodeId).catch(() => []);
        const ids = new Set<string>();
        for (const asset of assets) {
            for (const candidate of [asset.path, asset.name]) {
                const match = candidate?.match(/(?:^|\/)definitions\/flows\/([^/]+)\/draft\.json$/);
                if (match) ids.add(match[1]);
            }
        }
        const drafts = await Promise.all([...ids].map(id => this.loadDraft(id)));
        return drafts.filter((draft): draft is FlowDraft => Boolean(draft))
            .sort((left, right) => right.updatedAt - left.updatedAt);
    }

    async saveDraft(draft: FlowDraft, expectedDraftVersion: number): Promise<FlowDraft> {
        const current = await this.read<FlowDraft>(this.draftName(String(draft.id)));
        const actualVersion = current?.draftVersion ?? 0;
        if (actualVersion !== expectedDraftVersion) {
            throw new FlowDraftVersionConflictError(String(draft.id), expectedDraftVersion, actualVersion);
        }
        const saved = { ...draft, draftVersion: actualVersion + 1, updatedAt: Date.now() };
        await this.write(this.draftName(String(draft.id)), saved);
        return saved;
    }

    async loadDraft(id: string): Promise<FlowDraft | null> {
        return this.read<FlowDraft>(this.draftName(id));
    }

    /** v3 immutable revision boundary with handler/port/cycle validation. */
    async saveRevision(revision: FlowRevision): Promise<FlowRevision> {
        const issues = validateFlowRevision(revision, this.plugins);
        if (issues.length) {
            throw new Error(`Invalid FlowRevision: ${issues.map(issue => issue.message).join('; ')}`);
        }
        const computed = flowRevisionDigest(revision);
        if (revision.digest !== computed) throw new Error(`FlowRevision digest mismatch: expected ${computed}, got ${revision.digest}`);
        const name = this.v3RevisionName(String(revision.id), revision.revision);
        const existing = await this.read<FlowRevision>(name);
        if (existing) {
            if (existing.digest !== revision.digest) throw new Error(`FlowRevision ${revision.id} r${revision.revision} is immutable`);
            return existing;
        }
        await this.engine.createAsset(this.nodeId, name, JSON.stringify(revision, null, 2));
        await this.engine.createAsset(this.nodeId, this.v3LatestName(String(revision.id)), JSON.stringify({ revision: revision.revision }));
        return revision;
    }

    async loadRevision(id: string, revision?: number): Promise<FlowRevision | null> {
        let resolved = revision;
        if (resolved === undefined) resolved = (await this.read<{ revision: number }>(this.v3LatestName(id)))?.revision;
        return resolved === undefined ? null : this.read<FlowRevision>(this.v3RevisionName(id, resolved));
    }

    async listRevisions(id: string): Promise<FlowRevision[]> {
        const assets = await this.engine.getAssets(this.nodeId).catch(() => []);
        const prefix = `definitions/flows/${id}/revision-`;
        const revisions: FlowRevision[] = [];
        for (const asset of assets) {
            const candidates = [asset.path, asset.name].filter((value): value is string => Boolean(value));
            const candidate = candidates.find(value => value.startsWith(prefix))
                ?? candidates.find(value => /(?:^|\/)revision-\d+\.json$/.test(value));
            if (!candidate) continue;
            const match = candidate.match(/revision-(\d+)\.json$/);
            if (!match) continue;
            const loaded = await this.read<FlowRevision>(this.v3RevisionName(id, Number(match[1])));
            if (loaded && !revisions.some(item => item.revision === loaded.revision)) revisions.push(loaded);
        }
        return revisions.sort((a, b) => a.revision - b.revision);
    }

    async createRevision(draft: FlowDraft): Promise<FlowRevision> {
        const latest = await this.loadRevision(String(draft.id));
        const withoutDigest = {
            id: draft.id,
            revision: (latest?.revision ?? 0) + 1,
            name: draft.name,
            nodes: structuredClone(draft.nodes),
            edges: structuredClone(draft.edges),
            createdAt: Date.now(),
        };
        return this.saveRevision({ ...withoutDigest, digest: flowRevisionDigest(withoutDigest) });
    }

    private async read<T>(name: string): Promise<T | null> {
        try {
            const content = await this.engine.readAsset(this.nodeId, name);
            const text = typeof content === 'string'
                ? content
                : content
                    ? new TextDecoder().decode(content)
                    : null;
            return text ? JSON.parse(text) as T : null;
        } catch {
            return null;
        }
    }

    private async write(name: string, value: unknown): Promise<void> {
        await this.engine.createAsset(this.nodeId, name, JSON.stringify(value, null, 2));
    }

    private draftName(id: string): string {
        assertFlowId(id);
        return `definitions/flows/${id}/draft.json`;
    }
    private v3RevisionName(id: string, revision: number): string {
        assertFlowId(id);
        if (!Number.isInteger(revision) || revision < 1) throw new Error(`Invalid Flow revision: ${revision}`);
        return `definitions/flows/${id}/revision-${revision}.json`;
    }
    private v3LatestName(id: string): string {
        assertFlowId(id);
        return `definitions/flows/${id}/latest.json`;
    }
}

function assertFlowId(id: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) || id.includes('..')) {
        throw new Error('Flow ID must use 1-128 letters, numbers, dots, underscores or hyphens');
    }
}
