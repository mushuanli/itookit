// @file: llm-ui/services/StateService.ts

import { ILLMSessionEngine } from '@itookit/llm-engine';

export interface UIState {
    collapse_states: Record<string, boolean>;
    input_text?: string;
    input_agent_id?: string;
}

/**
 * UI 状态持久化服务
 * 职责：UI 状态的保存和加载
 */
export class StateService {
    constructor(private engine: ILLMSessionEngine) { }

    /**
     * 保存 UI 状态
     */
    async saveUIState(nodeId: string, state: UIState): Promise<void> {
        try {
            await this.engine.updateUIState(nodeId, state);
            console.log('[StateService] UI state saved');
        } catch (e: any) {
            if (this.isNodeNotFoundError(e)) {
                return; // 节点已删除，忽略错误
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

    /**
     * 判断是否为节点不存在错误
     */
    private isNodeNotFoundError(error: any): boolean {
        return error.message?.includes('not found') ||
            error.message?.includes('Node not found');
    }
}
