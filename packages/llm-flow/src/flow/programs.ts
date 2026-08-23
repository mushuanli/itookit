import type { DagNodeOutcome } from '@itookit/common';
import type {
    Decision,
    DurableTaskProgram,
    JsonValue,
    TaskInputEvent,
} from '@itookit/kernel';
import {
    collectDependency,
    dependenciesReady,
    dependencyWait,
} from '@itookit/llm-tasks';
import { reduceOutcome, routeOutcome, spawnOutcome, transformOutcome } from './operations';

export interface FlowDependencyBinding {
    taskId: string;
    input: string;
    output?: string;
    edgeId?: string;
}

export interface FlowValueInput {
    operation: 'transform' | 'reduce' | 'route';
    config: Record<string, JsonValue>;
    inputs: Record<string, JsonValue>;
    dependencies: FlowDependencyBinding[];
}

interface FlowValueState extends FlowValueInput {
    dependencyOutputs: Record<string, JsonValue>;
    resolvedDependencyIds: string[];
}

export class FlowValueProgram implements DurableTaskProgram<FlowValueState, FlowValueInput, DagNodeOutcome> {
    readonly manifest = { kind: 'flow.value', version: '1' };

    init(input: FlowValueInput): Decision<FlowValueState, DagNodeOutcome> {
        const state = { ...clone(input), dependencyOutputs: {}, resolvedDependencyIds: [] };
        return input.dependencies.length ? { state, next: dependencyWait(input.dependencies) } : completeValue(state);
    }

    reduce(state: Readonly<FlowValueState>, event: TaskInputEvent): Decision<FlowValueState, DagNodeOutcome> {
        const next = clone(state) as FlowValueState;
        collectDependency(next.dependencies, next.dependencyOutputs, next.resolvedDependencyIds, event, 'result');
        return dependenciesReady(next.dependencies, next.resolvedDependencyIds)
            ? completeValue(next)
            : { state: next, next: dependencyWait(next.dependencies) };
    }
}

export interface FlowHumanInput {
    requestId: string;
    prompt: string;
    schema?: JsonValue;
    dependencies: FlowDependencyBinding[];
}

interface FlowHumanState extends FlowHumanInput {
    phase: 'dependencies' | 'interaction';
    dependencyOutputs: Record<string, JsonValue>;
    resolvedDependencyIds: string[];
}

export class FlowHumanProgram implements DurableTaskProgram<FlowHumanState, FlowHumanInput, DagNodeOutcome> {
    readonly manifest = { kind: 'flow.human', version: '1' };

    init(input: FlowHumanInput): Decision<FlowHumanState, DagNodeOutcome> {
        if (!input.prompt.trim()) throw new Error('Human Flow node requires a prompt');
        const state: FlowHumanState = {
            ...clone(input), phase: input.dependencies.length ? 'dependencies' : 'interaction',
            dependencyOutputs: {}, resolvedDependencyIds: [],
        };
        return input.dependencies.length ? { state, next: dependencyWait(input.dependencies) } : requestHuman(state);
    }

    reduce(state: Readonly<FlowHumanState>, event: TaskInputEvent): Decision<FlowHumanState, DagNodeOutcome> {
        const next = clone(state) as FlowHumanState;
        if (next.phase === 'dependencies') {
            collectDependency(next.dependencies, next.dependencyOutputs, next.resolvedDependencyIds, event, 'result');
            if (!dependenciesReady(next.dependencies, next.resolvedDependencyIds)) {
                return { state: next, next: dependencyWait(next.dependencies) };
            }
            next.phase = 'interaction';
            return requestHuman(next);
        }
        if (event.type !== 'interaction-resolved') return fail(next, `Expected interaction, received ${event.type}`);
        return {
            state: next,
            next: { type: 'complete', output: artifactOutcome('response', event.value) },
        };
    }
}

export interface FlowAggregateInput {
    dependencies: Array<{ taskId: string; nodeId: string }>;
}

interface FlowAggregateState extends FlowAggregateInput {
    outputs: Record<string, JsonValue>;
}

export class FlowAggregateProgram implements DurableTaskProgram<FlowAggregateState, FlowAggregateInput, JsonValue> {
    readonly manifest = { kind: 'flow.aggregate', version: '1' };

    init(input: FlowAggregateInput): Decision<FlowAggregateState, JsonValue> {
        const state = { ...clone(input), outputs: {} };
        return input.dependencies.length
            ? { state, next: dependencyWait(input.dependencies) }
            : { state, next: { type: 'complete', output: { nodes: {} } } };
    }

    reduce(state: Readonly<FlowAggregateState>, event: TaskInputEvent): Decision<FlowAggregateState, JsonValue> {
        const next = clone(state) as FlowAggregateState;
        if (event.type === 'task-exited') {
            const dependency = next.dependencies.find(item => item.taskId === event.taskId);
            if (dependency) next.outputs[dependency.nodeId] = jsonValue(event.exit.output);
        }
        const ready = next.dependencies.every(item => item.nodeId in next.outputs);
        return ready
            ? { state: next, next: { type: 'complete', output: { nodes: next.outputs } } }
            : { state: next, next: dependencyWait(next.dependencies) };
    }
}

function completeValue(state: FlowValueState): Decision<FlowValueState, DagNodeOutcome> {
    const inputs = { ...state.inputs, ...state.dependencyOutputs };
    const operation = state.operation === 'transform'
        ? transformOutcome
        : state.operation === 'reduce' ? reduceOutcome
        : state.operation === 'route' ? routeOutcome
        : spawnOutcome;
    return { state, next: { type: 'complete', output: operation(state.config, inputs) } };
}

function requestHuman(state: FlowHumanState): Decision<FlowHumanState, DagNodeOutcome> {
    return {
        state,
        actions: [{
            type: 'request-interaction',
            interaction: {
                id: state.requestId,
                kind: 'input',
                prompt: state.prompt,
                payload: state.schema ?? null,
            },
        }],
        next: { type: 'wait', on: { type: 'interaction', id: state.requestId } },
    };
}

function artifactOutcome(name: string, value: JsonValue): DagNodeOutcome {
    return { outputs: { [name]: { outputName: name, type: 'json', content: value } } };
}

function fail<S>(state: S, message: string): Decision<S, DagNodeOutcome> {
    return { state, next: { type: 'fail', error: { message } } };
}

function clone<T>(value: T): T { return structuredClone(value); }
function jsonValue(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value ?? null)) as JsonValue; }
