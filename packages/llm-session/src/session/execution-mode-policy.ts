import { t } from '@itookit/common';
import type { ChatExecutionMode, ChatSessionSettings } from '@itookit/llm-common';

/** Pure session policy shared by admission and transactional preference updates. */
export function assertExecutionMode(settings: Pick<ChatSessionSettings, 'executionMode' | 'executionModeLocked'>,
    requested: ChatExecutionMode | undefined): void {
    if (requested !== undefined && requested !== 'chat' && requested !== 'agent') throw new Error('Invalid chat execution mode');
    if (settings.executionModeLocked && requested !== undefined && requested !== (settings.executionMode ?? 'chat'))
        throw new Error(t('chatInput.executionMode.locked'));
}

export function mergeExecutionMode(current: Pick<ChatSessionSettings, 'executionMode' | 'executionModeLocked'>,
    patch: Pick<Partial<ChatSessionSettings>, 'executionMode' | 'executionModeLocked'>) {
    assertExecutionMode(current, patch.executionMode);
    return { executionMode: current.executionModeLocked ? current.executionMode ?? 'chat' : patch.executionMode ?? current.executionMode,
        executionModeLocked: current.executionModeLocked === true || patch.executionModeLocked === true };
}
