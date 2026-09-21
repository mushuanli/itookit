import type { FlowId, JsonValue } from './flow-definition';
import type { ChatExecutionMode } from '../chat';

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
        | { kind: 'agent'; agentId: string; mode?: ChatExecutionMode }
        | { kind: 'flow'; flowId: FlowId; revision?: number; parameters?: Record<string, JsonValue> };
}

export function createAgentSendIntent(agentId: string): SendIntent {
    return {
        branch: { mode: 'continue' },
        retention: { mode: 'persistent' },
        execution: { kind: 'agent', agentId },
    };
}
