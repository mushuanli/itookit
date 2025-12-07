// @file: llm-ui/core/types.ts

export type {OrchestratorEvent, SessionGroup, ExecutionNode,SessionRegistryEvent} from '@itookit/llm-engine';

export type NodeAction = 
    | 'retry' 
    | 'delete' 
    | 'edit' 
    | 'edit-and-retry' 
    | 'resend' 
    | 'prev-sibling' 
    | 'next-sibling';

export interface NodeActionCallback {
    (action: NodeAction, nodeId: string): void;
}

