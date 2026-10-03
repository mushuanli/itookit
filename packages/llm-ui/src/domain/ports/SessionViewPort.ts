import type { SessionGroup, SessionStatus, SessionEventEnvelope, RegistryEvent } from '@itookit/llm-session/contracts';
import type { ISession } from '@itookit/llm-session/contracts';
import type { PromptHistoryEntry } from '@itookit/llm-session/contracts';

export interface PromptHistoryPort {
    getRecent(count?: number): Promise<PromptHistoryEntry[]>;
    add(text: string, options?: { agentId?: string; sessionId?: string }): Promise<void>;
    remove(text: string): Promise<boolean>;
}

/** The editor needs observation and a command channel, not a session implementation. */
export interface SessionViewPort extends ISession {
    getDirectAgentPolicy?(): import('@itookit/llm-session/contracts').ResolvedDirectAgentPolicy;
    getSessions(): SessionGroup[];
    getStatus(): SessionStatus | 'unbound';
    isGenerating(): boolean;
    onEvent(handler: (event: SessionEventEnvelope) => void): () => void;
    onGlobalEvent(handler: (event: RegistryEvent) => void): () => void;
    readonly promptHistory?: PromptHistoryPort;
}
