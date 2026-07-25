import type { FlowId } from './harness-v3';

export type FlowNodeId = string;

export interface SendIntent {
    branch: {
        mode: 'continue' | 'fork';
        baseRoundId?: string;
        newBranchName?: string;
    };
    retention: {
        mode: 'persistent' | 'temporary';
    };
    execution:
        | { kind: 'agent'; agentId: string }
        | { kind: 'flow'; flowId: FlowId; revision?: number };
}

export function createAgentSendIntent(agentId: string): SendIntent {
    return {
        branch: { mode: 'continue' },
        retention: { mode: 'persistent' },
        execution: { kind: 'agent', agentId },
    };
}
