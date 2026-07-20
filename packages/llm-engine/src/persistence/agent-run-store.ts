// @file: llm-engine/src/persistence/agent-run-store.ts
// AgentRunStore — persist and load AgentRun state.
//
// Phase 3 (WP-06): Each AgentRun is tracked through its lifecycle
// (pending → ready → running → succeeded/failed/interrupted/cancelled).
// Runs are stored per-goal in the session asset directory.
//
// Storage layout:
//   <goalId>/
//     goal.json
//     run-<runId>.json
//     artifact-<artifactId>.json

import type {
    AgentRun,
    AgentRunId,
    AgentRunStatus,
    AgentRunAttempt,
    Artifact,
} from '@itookit/common';
import type { IChatEngine } from './types';
import { ulid } from './ulid';

export class AgentRunStore {
    constructor(
        private readonly engine: IChatEngine,
        private readonly nodeId: string,
    ) {}

    // ── AgentRun CRUD ─────────────────────────────────────────────────────

    async createRun(spec: {
        id?: AgentRunId;
        goalId?: string;
        spec: AgentRun['spec'];
        branchRef?: string;
        branchHead?: string | null;
    }): Promise<AgentRun> {
        const run: AgentRun = {
            id: spec.id ?? ulid() as AgentRunId,
            goalId: spec.goalId,
            spec: spec.spec,
            status: 'pending',
            branchRef: spec.branchRef,
            branchHead: spec.branchHead ?? null,
            attempts: [],
            outputArtifactIds: [],
        };
        await this.writeRun(run);
        return run;
    }

    async loadRun(runId: AgentRunId): Promise<AgentRun | null> {
        try {
            const file = this.engine.openFile(this.nodeId);
            const text = await file.asset(`run-${runId}.json`).readText();
            if (text) return JSON.parse(text) as AgentRun;
        } catch { /* missing */ }
        return null;
    }

    /** Transition status with idempotency. No-op if already in terminal state. */
    async transitionStatus(
        runId: AgentRunId,
        newStatus: AgentRunStatus,
    ): Promise<AgentRun> {
        const run = await this.loadRun(runId);
        if (!run) throw new Error(`AgentRun not found: ${runId}`);

        const terminal: AgentRunStatus[] = ['succeeded', 'failed', 'cancelled', 'skipped'];
        if (terminal.includes(run.status) && newStatus !== run.status) {
            throw new Error(`Cannot transition from terminal status "${run.status}" to "${newStatus}"`);
        }

        run.status = newStatus;
        await this.writeRun(run);
        return run;
    }

    async addAttempt(runId: AgentRunId, attempt: AgentRunAttempt): Promise<AgentRun> {
        const run = await this.loadRun(runId);
        if (!run) throw new Error(`AgentRun not found: ${runId}`);

        run.attempts.push(attempt);
        run.status = attempt.status === 'running' ? 'running' : run.status;
        await this.writeRun(run);
        return run;
    }

    async setSnapshotId(runId: AgentRunId, snapshotId: string): Promise<AgentRun> {
        const run = await this.loadRun(runId);
        if (!run) throw new Error(`AgentRun not found: ${runId}`);
        run.contextSnapshotId = snapshotId;
        await this.writeRun(run);
        return run;
    }

    // ── Artifact CRUD ─────────────────────────────────────────────────────

    async saveArtifact(artifact: Artifact): Promise<Artifact> {
        const id = artifact.id || ulid();
        const persisted: Artifact = {
            ...artifact,
            id,
            contentHash: artifact.contentHash || await this.hashContent(artifact.content),
            createdAt: artifact.createdAt || Date.now(),
        };
        await this.engine.createAsset(
            this.nodeId,
            `artifact-${id}.json`,
            JSON.stringify(persisted, null, 2),
        );
        return persisted;
    }

    async loadArtifact(artifactId: string): Promise<Artifact | null> {
        try {
            const file = this.engine.openFile(this.nodeId);
            const text = await file.asset(`artifact-${artifactId}.json`).readText();
            if (text) return JSON.parse(text) as Artifact;
        } catch { /* missing */ }
        return null;
    }

    // ── Private ──────────────────────────────────────────────────────────

    private async writeRun(run: AgentRun): Promise<void> {
        await this.engine.createAsset(
            this.nodeId,
            `run-${run.id}.json`,
            JSON.stringify(run, null, 2),
        );
    }

    private async hashContent(content: string | Record<string, unknown>): Promise<string> {
        const str = typeof content === 'string' ? content : JSON.stringify(content);
        const data = new TextEncoder().encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
}
