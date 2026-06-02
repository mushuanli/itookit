// @file: llm-ui/services/StateService.ts

import { IChatEngine } from '@itookit/llm-engine';
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
            await this.engine.updateUIState(nodeId, state);
            console.log('[StateService] UI state saved');
        } catch (e: any) {
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
            return await this.engine.getUIState(nodeId) as UIState;
        } catch (e) {
            console.warn('[StateService] Failed to load UI state:', e);
            return null;
        }
    }
}
