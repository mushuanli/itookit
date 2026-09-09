import type { DagRunSpec, DagNodeDefinition, DagEdgeDefinition, JsonValue } from '@itookit/common';
import type { DelegationGroup, EdgeState } from './delegation-runtime';

/** Scheduler state saved at an explicit human-interaction boundary. */
export interface SchedulerCheckpoint {
    version: 1;
    spec: DagRunSpec;
    parameters?: Record<string, JsonValue>;
    sessionContext?: { projectInstructions: string; skillInstructions: string; skillIndex: string };
    instances: [string, string[]][];
    completed: string[];
    nodes: DagNodeDefinition[];
    edges: DagEdgeDefinition[];
    edgeState: [string, EdgeState][];
    delegationDepth: [string, number][];
    delegationGroups: [string, Omit<DelegationGroup, 'children' | 'completed' | 'succeeded'> & {
        children: string[]; completed: string[]; succeeded: string[];
    }][];
    delegationGroupByChild: [string, string][];
    skipped: string[];
    detachedNodes: string[];
    appliedPatches: [string, string][];
    nodeDefaults: [string, Record<string, unknown>][];
    nodeConnections: [string, NonNullable<DagRunSpec['nodeConnections']>[string]][];
    consumedTokens: number;
    startedAt: number;
    completionOrder: string[];
    dispatchOrder: string[];
}
