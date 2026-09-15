import type { JsonValue } from '@itookit/common';
import type { Decision, DurableTaskProgram, KernelAction, TaskInputEvent } from '@itookit/durable-kernel';
import { collectDependency, dependenciesReady, dependencyWait } from '@itookit/llm-tasks';
import { evaluate } from '../operations';
import { flowSchemaIssue } from '../schema-registry';
import { invalidFields, mergeInput } from './input';
import { createInvocation, dispatchView, invocationKey, resultValue } from './invocation';
import type { DispatchInput, DispatchState } from './types';
import { FlowReducerRegistry, orderedUpdates, projectSummary } from './join';
import { mergeResults } from './results';
import { validateDispatch } from './validation';
import { object, outcome } from './value';

type Step = Decision<DispatchState, unknown>;

export class FlowDispatchProgram implements DurableTaskProgram<DispatchState, DispatchInput, unknown> {
    constructor(private readonly reducers = new FlowReducerRegistry()) {}
    readonly manifest = { kind: 'flow.dispatch', version: '1' };

    init(input: DispatchInput): Step {
        validateDispatch(input);
        if (input.join && !this.reducers.has(input.join.reducer)) throw new Error(`Unknown reducer: ${input.join.reducer}`);
        const state: DispatchState = { ...structuredClone(input), phase: 'dependencies', round: 0,
            dependencyOutputs: {}, resolvedDependencyIds: [], results: {}, selected: [], spawned: [], received: {}, failures: {},
            inputRevision: input.inputRevision ?? '1', revisionSequence: 0, revisionValues: {}, consumedTokens: 0 };
        for (const [key, value] of Object.entries(input.initialResults ?? {})) {
            state.results[key] = { value, inputRevision: state.inputRevision, round: 0, taskId: 'initial' };
        }
        if (input.join && Object.keys(state.results).length) state.summary = this.reducers.reduce(input.join, undefined, state.results);
        return collectInputs(state);
    }

    reduce(current: Readonly<DispatchState>, event: TaskInputEvent): Step {
        const state = structuredClone(current) as DispatchState;
        if (state.phase === 'dependencies') {
            collectDependency(state.dependencies, state.dependencyOutputs, state.resolvedDependencyIds, event, 'result');
            return collectInputs(state);
        }
        if (state.phase === 'revision') return revise(state, event);
        receive(state, event);
        if (Object.keys(state.received).length + Object.keys(state.failures).length < state.selected.length) return spawnAvailable(state);
        if (Object.keys(state.failures).length && state.join?.failure !== 'partial') return { state, next: { type: 'fail', error: { message: JSON.stringify(state.failures) } } };
        const updates = orderedUpdates(state.selected, state.received);
        if (state.join) state.summary = this.reducers.reduce(state.join, state.summary, updates);
        state.results = mergeResults(state.results, updates);
        for (const key of Object.keys(state.failures)) if (state.results[key]) state.results[key].inputRevision = `failed:${state.inputRevision}`;
        return afterBatch(state);
    }
}

function collectInputs(state: DispatchState): Step {
    if (!dependenciesReady(state.dependencies, state.resolvedDependencyIds)) return { state, next: dependencyWait(state.dependencies) };
    state.values = { ...state.values, ...object(state.dependencyOutputs.input) } as Record<string, JsonValue>;
    for (const [key, value] of Object.entries(state.dependencyOutputs)) if (key !== 'input') state.values[key] = value;
    state.phase = 'dispatch';
    return nextBatch(state);
}

function nextBatch(state: DispatchState): Step {
    if (evaluate(state.until, dispatchView(state))) return complete(state, 'condition_met');
    if (state.round >= state.maxRounds) return complete(state, 'max_rounds');
    state.round++;
    const candidates = state.branches.filter(branch => !branch.when || evaluate(branch.when, dispatchView(state)));
    if (state.selectionOrder !== 'declared') candidates.sort((a, b) =>
        Number(state.results[a.key]?.inputRevision === state.inputRevision) - Number(state.results[b.key]?.inputRevision === state.inputRevision));
    state.selected = (state.mode === 'exclusive' ? candidates.slice(0, 1) : candidates).map(branch => branch.key);
    if (!state.selected.length) return { state, next: { type: 'fail', error: { message: 'Route selected no branch before its stop condition' } } };
    state.spawned = []; state.received = {}; state.failures = {};
    return spawnAvailable(state);
}

function spawnAvailable(state: DispatchState): Step {
    const settled = Object.keys(state.received).length + Object.keys(state.failures).length;
    const capacity = (state.maxConcurrency ?? state.selected.length) - state.spawned.length + settled;
    const additions = state.selected.filter(key => !state.spawned.includes(key)).slice(0, capacity);
    const actions: KernelAction[] = additions.map(key => ({ type: 'spawn', spawnKey: invocationKey(state, key),
        spec: createInvocation(state, state.branches.find(branch => branch.key === key)!) }));
    state.spawned.push(...additions);
    const pending = state.spawned.filter(key => !state.received[key] && !state.failures[key]);
    return { state, actions, next: { type: 'wait', on: { type: 'any',
        waits: pending.map(key => ({ type: 'child', spawnKey: invocationKey(state, key) })) } } };
}

function receive(state: DispatchState, event: TaskInputEvent): void {
    if (event.type !== 'task-exited') return;
    const key = state.spawned.find(key => invocationKey(state, key) === event.spawnKey);
    if (!key || state.received[key] || state.failures[key]) return;
    const usage = object(object(event.exit.output).usage);
    const tokens = usage.total_tokens ?? usage.totalTokens;
    if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0) state.consumedTokens += tokens;
    if (event.exit.status !== 'succeeded') { state.failures[key] = event.exit.error?.message || event.exit.status; return; }
    const branch = state.branches.find(branch => branch.key === key)!;
    try {
        const value = resultValue(event.exit.output, branch);
        const contract = state.invocationDefaults?.outputContract;
        const sharedIssue = contract?.schema !== undefined ? flowSchemaIssue(contract.schema, value) : undefined;
        if (sharedIssue || (contract?.validate && !evaluate(contract.validate, { value }))) throw new Error(sharedIssue ?? 'Shared output constraint failed');
        const issue = branch.outputSchema !== undefined ? flowSchemaIssue(branch.outputSchema, value) : undefined;
        if (issue || (branch.validate && !evaluate(branch.validate, { value }))) throw new Error(issue ?? 'Output constraint failed');
        state.received[key] = { value, taskId: event.taskId, inputRevision: state.inputRevision, round: state.round };
    } catch (error) { state.failures[key] = String(error); }
}

function afterBatch(state: DispatchState): Step {
    if (evaluate(state.until, dispatchView(state))) return complete(state, 'condition_met');
    if (state.round >= state.maxRounds) return complete(state, 'max_rounds');
    if (!state.revision) return nextBatch(state);
    state.phase = 'revision'; state.revisionValues = {};
    return requestRevision(state);
}

function requestRevision(state: DispatchState): Step {
    const id = `revision-${++state.revisionSequence}`;
    return { state, actions: [{ type: 'request-interaction', interaction: { id, kind: 'input',
        prompt: state.revision!.prompt, payload: { fields: state.revision!.fields, state: dispatchView(state) } as unknown as JsonValue } }],
        next: { type: 'wait', on: { type: 'interaction', id } } };
}

function revise(state: DispatchState, event: TaskInputEvent): Step {
    const id = `revision-${state.revisionSequence}`;
    if (event.type !== 'interaction-resolved' || event.interactionId !== id) return { state, next: { type: 'wait', on: { type: 'interaction', id } } };
    const fields = state.revision!.fields;
    mergeInput(fields, state.revisionValues, event.value, Object.keys(fields));
    if (invalidFields(fields, state.revisionValues).length) return requestRevision(state);
    const changed = Object.entries(state.revisionValues).some(([key, value]) => JSON.stringify(state.values[key]) !== JSON.stringify(value));
    state.values = { ...state.values, ...state.revisionValues };
    if (changed) state.inputRevision = `${state.inputRevision}:${state.round}`;
    state.phase = 'dispatch';
    return nextBatch(state);
}

function complete(state: DispatchState, stopReason: string): Step {
    const summary = state.summary === undefined ? {} : { summary: projectSummary(state.join, state.summary) };
    return { state, next: { type: 'complete', output: { ...outcome({ ...dispatchView(state), ...summary, ...(state.join ? { failures: state.failures } : {}), completedRounds: state.round, stopReason }),
        usage: { total_tokens: state.consumedTokens } } } };
}
