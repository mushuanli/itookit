/** Legacy host entry; the chat entry itself has no singleton or Session runtime imports. */
import { createLLMFactory as createChatFactory } from './chat';
import { getSessionManager, getPromptHistory } from '@itookit/llm-session';
import type { SessionViewPort } from './domain/ports/SessionViewPort';
export * from './chat';
export * from './settings';
export { VFSAgentService } from '@itookit/llm-session';

export const createLLMFactory: typeof createChatFactory = (service, deps) =>
    createChatFactory(service, { ...deps, resolveSessionView: deps.resolveSessionView ?? legacySessionView });

function legacySessionView(): SessionViewPort {
    const manager = getSessionManager();
    return { id: manager.id, signal: manager.signal.bind(manager), events: manager.events.bind(manager),
        getSessions: manager.getSessions.bind(manager), getStatus: manager.getStatus.bind(manager),
        isGenerating: manager.isGenerating.bind(manager), onEvent: manager.onEvent.bind(manager),
        onGlobalEvent: manager.onGlobalEvent.bind(manager), promptHistory: manager.promptHistory ?? getPromptHistory() };
}
