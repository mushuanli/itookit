import type { SessionGroup, SessionStatus, SessionEventEnvelope, RegistryEvent } from '@itookit/llm-session/contracts';
import type { ISession } from '@itookit/llm-session/contracts';
import type { PromptHistoryService } from '@itookit/llm-session';

export type PromptHistoryPort = Pick<PromptHistoryService, 'getRecent' | 'add' | 'remove'>;

/** The editor needs observation and a command channel, not a session implementation. */
export interface SessionViewPort extends ISession {
    getSessions(): SessionGroup[];
    getStatus(): SessionStatus | 'unbound';
    isGenerating(): boolean;
    onEvent(handler: (event: SessionEventEnvelope) => void): () => void;
    onGlobalEvent(handler: (event: RegistryEvent) => void): () => void;
    readonly promptHistory?: PromptHistoryPort;
}
