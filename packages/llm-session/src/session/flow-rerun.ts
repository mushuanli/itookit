import { FlowDefinitionStore, validateFlowParameters, hasValidationErrors, type FlowStore } from '@itookit/llm-flow';
import type { JsonValue, Round } from '@itookit/common';
import { RoundLog } from '../persistence/round-log';
import { ulid } from '../persistence/ulid';
import type { SessionRegistry } from './session-registry';
import type { SessionRunCoordinator } from './session-run-coordinator';

/** A rerun creates a replacement branch; it never edits a previous invocation. */
export class FlowRerunService {
    private pending = false;
    constructor(private registry: SessionRegistry, private runs: SessionRunCoordinator, private store: FlowStore) {}

    async context() {
        const { sessionId, state } = this.registry.ensureBound();
        const log = new RoundLog(this.registry.engine, sessionId);
        const fallback = (await this.registry.engine.getManifest(sessionId))?.flow;
        for (const projection of [...state.getRounds()].reverse()) {
            const round = await log.readRound(projection.roundId);
            const flow = round?.flow ?? (projection === state.getRounds()[0] ? fallback : undefined);
            if (!round || !flow) continue;
            const definition = await new FlowDefinitionStore(this.store).loadRevision(flow.flowId, flow.revision);
            if (!definition) throw new Error(`Flow revision not found: ${flow.flowId}@${flow.revision}`);
            return { sessionId, sourceRoundId: round.id, flow, definition, agentId: round.agentId ?? 'default' };
        }
        return null;
    }

    async run(parameters: Record<string, JsonValue>, sourceRoundId: string) {
        if (this.pending) throw new Error('Flow rerun is already being submitted');
        this.pending = true;
        try { return await this.submit(parameters, sourceRoundId); }
        finally { this.pending = false; }
    }

    private async submit(parameters: Record<string, JsonValue>, sourceRoundId: string) {
        this.registry.ensureNotGenerating('rerun flow');
        const context = await this.context();
        if (!context || context.sourceRoundId !== sourceRoundId) throw new Error('Flow branch changed; reopen the rerun form');
        const issues = validateFlowParameters(context.definition.parameters, parameters);
        if (hasValidationErrors(issues)) throw new Error(issues.map(issue => issue.message).join('; '));
        this.registry.ensureNotGenerating('rerun flow');
        const { sessionId, state, runtime } = this.registry.ensureBound();
        if (sessionId !== context.sessionId) throw new Error('Session changed; reopen the rerun form');
        return this.launch(context, parameters, { sessionId, state, runtime });
    }

    private async launch(context: NonNullable<Awaited<ReturnType<FlowRerunService['context']>>>,
        parameters: Record<string, JsonValue>, bound: ReturnType<SessionRegistry['ensureBound']>) {
        const { sessionId, state, runtime } = bound;
        const log = new RoundLog(this.registry.engine, sessionId), roundId = ulid();
        const previous = await log.loadManifest();
        const branch = await log.createBranchForReplacement(context.sourceRoundId, roundId, { createdFrom: 'regenerate' });
        const flow: NonNullable<Round['flow']> = { flowId: context.definition.id, revision: context.definition.revision, parameters };
        try {
            await this.registry.reloadSessionData(sessionId, state);
            this.switched(sessionId, branch.branchName, branch.commonHeadId ?? '', roundId);
            const taskId = await this.runs.submit({ sessionId, text: `${context.definition.name}\n\n${JSON.stringify(parameters, null, 2)}`,
                files: [], agentId: context.agentId, roundTarget: { mode: 'append-new', roundId },
                sendIntent: { branch: { mode: 'continue' }, retention: { mode: 'persistent' }, execution: { kind: 'flow', ...flow } },
            }, runtime);
            return { taskId, branchName: branch.branchName };
        } catch (error) {
            const current = await log.loadManifest();
            if (current.currentBranch === branch.branchName && current.currentHead === (branch.commonHeadId ?? null)) {
                delete current.branches[branch.branchName]; delete current.branchMeta[branch.branchName];
                current.currentBranch = previous.currentBranch; current.currentHead = current.branches[previous.currentBranch] ?? null;
                await log.saveManifest(current);
                await this.registry.reloadSessionData(sessionId, state);
                this.switched(sessionId, current.currentBranch, current.currentHead ?? '');
            }
            throw error;
        }
    }

    private switched(sessionId: string, branchName: string, headRoundId: string, branchRootRoundId?: string): void {
        this.registry.eventBus.emitSession(sessionId, { type: 'branch:switched', payload: {
            branchName, headRoundId, branchRootRoundId, reason: branchRootRoundId ? 'regenerate' : 'manual-switch', displayPosition: 'top',
        } });
    }
}
