// @file: llm-ui/services/StateService.ts

import type {
    ConversationUIState,
    IChatEngine,
} from '@itookit/llm-conversation';
import type { UIState } from '../domain/types';
import { ErrorHandler } from '../utils/errorHandler';

/**
 * UI 状态持久化服务
 * 职责：UI 状态的保存和加载
 */
export class StateService {
    constructor(private engine: IChatEngine) { }

    /**
     * 保存 UI 状态
     */
    async saveUIState(nodeId: string, state: UIState): Promise<void> {
        try {
            await this.engine.updateUIState(nodeId, toConversationState(state));
            console.log('[StateService] UI state saved');
        } catch (e: unknown) {
            if (e instanceof Error && ErrorHandler.classifyError(e).userMessage === 'The requested resource was not found.') {
                return; // node deleted, ignore
            }
            console.warn('[StateService] Failed to save UI state:', e);
            throw e;
        }
    }

    /**
     * 加载 UI 状态
     */
    async loadUIState(nodeId: string): Promise<UIState | null> {
        try {
            const state = await this.engine.getUIState(nodeId);
            return state ? fromConversationState(state) : null;
        } catch (e) {
            console.warn('[StateService] Failed to load UI state:', e);
            return null;
        }
    }
}

function toConversationState(state: UIState): ConversationUIState {
    return {
        collapseStates: state.collapse_states,
        historyVisibility: state.history_visibility,
        inputText: state.input_text,
        inputAgentId: state.input_agent_id,
    };
}

function fromConversationState(state: ConversationUIState): UIState {
    return {
        collapse_states: state.collapseStates ?? {},
        history_visibility: state.historyVisibility,
        input_text: state.inputText,
        input_agent_id: state.inputAgentId,
    };
}
