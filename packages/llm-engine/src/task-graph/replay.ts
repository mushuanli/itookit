import type {
    Artifact,
    TaskGraphEventEnvelope,
    TaskGraphRun,
    TaskGraphEvent,
    TaskRun,
    TaskRunStatus,
} from '@itookit/common';

/**
 * Rebuild the durable TaskGraph projection from the event stream.
 * Immutable payloads (Artifact/ContextSnapshot/StateRevision) stay in their
 * own stores; the replay only restores their references in the graph.
 */
export function replayTaskGraphRun(seed: TaskGraphRun, events: readonly TaskGraphEventEnvelope[]): TaskGraphRun {
    const run = structuredClone(seed);
    run.tasks ??= {};
    run.edges ??= [];
    run.edgeStates ??= {};

    for (const envelope of [...events].sort((a, b) => a.sequence - b.sequence)) {
        applyEvent(run, envelope);
    }
    return run;
}

function applyEvent(run: TaskGraphRun, envelope: TaskGraphEventEnvelope): void {
    const event = envelope.event;
    switch (event.type) {
        case 'GraphRunCreated':
            run.flow = structuredClone(event.flow);
            run.limits = structuredClone(event.limits);
            if (run.status === 'pending') run.status = 'pending';
            break;
        case 'TaskRunCreated': {
            const spec = event.task;
            const existing = run.tasks?.[spec.id];
            if (!existing) {
                const task: TaskRun = {
                    id: spec.id,
                    graphRunId: run.id,
                    spec: structuredClone(spec),
                    status: 'pending',
                    attempts: [],
                    outputArtifactIds: [],
                    spawnDepth: 0,
                    createdAt: envelope.occurredAt,
                };
                run.tasks![spec.id] = task;
            }
            break;
        }
        case 'TaskRunReady': {
            const task = run.tasks?.[event.taskRunId];
            if (task && !terminal(task.status)) task.status = 'ready';
            break;
        }
        case 'TaskAttemptStarted': {
            const task = envelope.taskRunId ? run.tasks?.[envelope.taskRunId] : undefined;
            if (!task) break;
            if (!task.attempts.some(attempt => String(attempt.id) === String(event.attempt.id))) {
                task.attempts.push(structuredClone(event.attempt));
            }
            task.status = 'running';
            break;
        }
        case 'TaskAwaitingSignal': {
            const task = envelope.taskRunId ? run.tasks?.[envelope.taskRunId] : undefined;
            if (task) task.status = 'awaiting_signal';
            break;
        }
        case 'ArtifactCommitted': {
            const task = run.tasks?.[event.artifact.taskRunId];
            if (task && !task.outputArtifactIds.some(id => String(id) === String(event.artifact.id))) {
                task.outputArtifactIds.push(event.artifact.id);
            }
            break;
        }
        case 'TaskAttemptFinished': {
            const task = envelope.taskRunId ? run.tasks?.[envelope.taskRunId] : undefined;
            const attempt = task && envelope.attemptId
                ? task.attempts.find(item => String(item.id) === String(envelope.attemptId))
                : undefined;
            if (attempt) {
                attempt.status = event.outcome.status === 'skipped' ? 'failed' : event.outcome.status;
                attempt.completedAt = envelope.occurredAt;
                attempt.error = event.outcome.error;
            }
            if (task && event.outcome.status !== 'skipped') {
                const artifacts = event.outcome.artifacts ?? [];
                for (const edge of run.edges ?? []) {
                    if (String(edge.from) !== String(task.id)) continue;
                    const state = run.edgeStates![edge.id];
                    if (!state || state.state !== 'pending') continue;
                    state.state = event.outcome.status === 'succeeded'
                        ? edge.kind === 'data' ? 'satisfied' : 'activated'
                        : 'failed';
                    state.artifactIds = edge.kind === 'data'
                        ? artifacts.filter(artifact => !edge.binding?.outputName || artifact.outputName === edge.binding.outputName).map(artifact => artifact.id as import('@itookit/common').ArtifactId)
                        : artifacts.map(artifact => artifact.id as import('@itookit/common').ArtifactId);
                    state.updatedAt = envelope.occurredAt;
                }
            }
            break;
        }
        case 'TaskRunSettled': {
            const task = envelope.taskRunId ? run.tasks?.[envelope.taskRunId] : undefined;
            if (task) {
                task.status = event.status;
                task.completedAt = envelope.occurredAt;
            }
            break;
        }
        case 'EdgesDecided': {
            const active = new Set(event.decision.activatedEdgeIds.map(String));
            const skipped = new Set(event.decision.skippedEdgeIds.map(String));
            for (const edge of run.edges ?? []) {
                const state = run.edgeStates![edge.id];
                if (!state || (active.has(String(edge.id)) === false && skipped.has(String(edge.id)) === false)) continue;
                state.state = active.has(String(edge.id)) ? 'activated' : 'skipped';
                state.decidedByTaskRunId = envelope.taskRunId;
                state.reason = event.decision.reason;
                state.updatedAt = envelope.occurredAt;
            }
            break;
        }
        case 'GraphExpanded': {
            const expansion = event.expansion;
            for (const task of expansion.tasks ?? []) {
                if (!run.tasks![task.id]) run.tasks![task.id] = structuredClone(task);
            }
            for (const edge of expansion.edges ?? []) {
                if (run.edges!.some(existing => String(existing.id) === String(edge.id))) continue;
                run.edges!.push(structuredClone(edge));
                run.edgeStates![edge.id] ??= { edgeId: edge.id, graphRunId: run.id, state: 'pending', updatedAt: envelope.occurredAt };
            }
            run.graphVersion = Math.max(run.graphVersion, expansion.graphVersion);
            break;
        }
        case 'AgentStatePatchCommitted':
        case 'GraphRunSettled':
            if (event.type === 'GraphRunSettled') {
                run.status = event.status;
                run.completedAt = envelope.occurredAt;
            }
            break;
    }
}

function terminal(status: TaskRunStatus): boolean {
    return ['succeeded', 'failed', 'interrupted', 'cancelled', 'skipped'].includes(status);
}

/** Stable artifact reference projection used by replay/integration tests. */
export function artifactRefFromEvent(event: Extract<TaskGraphEvent, { type: 'ArtifactCommitted' }>): Pick<Artifact, 'id' | 'taskRunId' | 'outputName' | 'contentHash'> {
    return structuredClone(event.artifact);
}
