import type { DispatchBranch, DispatchConfig, JsonValue } from '@itookit/common';
import type { TaskSpec } from '@itookit/durable-kernel';
import type { FlowDependencyBinding } from '../programs';

export interface PreparedBranch extends DispatchBranch {
    task: TaskSpec;
    instructions: string[];
}

export interface DispatchInput extends Omit<DispatchConfig, 'branches'> {
    invocationNamespace: string;
    branches: PreparedBranch[];
    values: Record<string, JsonValue>;
    dependencies: FlowDependencyBinding[];
}

export interface ResultSlot {
    value: JsonValue;
    inputRevision: string;
    round: number;
    taskId: string;
}

export interface DispatchState extends DispatchInput {
    summary?: JsonValue;
    phase: 'dependencies' | 'dispatch' | 'revision';
    round: number;
    dependencyOutputs: Record<string, JsonValue>;
    resolvedDependencyIds: string[];
    results: Record<string, ResultSlot>;
    selected: string[];
    spawned: string[];
    received: Record<string, ResultSlot>;
    failures: Record<string, string>;
    inputRevision: string;
    revisionSequence: number;
    revisionValues: Record<string, JsonValue>;
    consumedTokens: number;
}
