// @file: llm-ui/helpers/StateManager.ts

import { StateService, UIState } from '../services';
import { ChatInput } from '../components/ChatInput';

export type CollapseStateMap = Record<string, boolean>;

/**
 * 状态管理器
 * 职责：防抖保存、缓存管理、状态恢复
 */
export class StateManager {
    private collapseStatesCache: CollapseStateMap = {};
    private uiStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private inputStateSaveTimer: ReturnType<typeof setTimeout> | null = null;

    private readonly UI_STATE_SAVE_DEBOUNCE = 2000;
    private readonly INPUT_STATE_SAVE_DEBOUNCE = 1000;

    constructor(
        private stateService: StateService,
        private contentService: any, // 用于检查 isGenerating
        private nodeId: string
    ) { }

    /**
     * 获取折叠状态缓存
     */
    getCollapseStates(): CollapseStateMap {
        return this.collapseStatesCache;
    }

    /**
     * 设置折叠状态缓存
     */
    setCollapseStates(states: CollapseStateMap): void {
        this.collapseStatesCache = states;
    }

    /**
     * 防抖保存 UI 状态
     */
    scheduleUIStateSave(states: CollapseStateMap): void {
        this.collapseStatesCache = states;

        if (this.contentService.isGenerating()) {
            return;
        }

        if (this.uiStateSaveTimer) {
            clearTimeout(this.uiStateSaveTimer);
        }

        this.uiStateSaveTimer = setTimeout(async () => {
            if (!this.contentService.isGenerating()) {
                await this.saveUIState();
            }
        }, this.UI_STATE_SAVE_DEBOUNCE);
    }

    /**
     * 防抖保存输入状态
     */
    scheduleInputStateSave(): void {
        if (this.contentService.isGenerating()) {
            return;
        }

        if (this.inputStateSaveTimer) {
            clearTimeout(this.inputStateSaveTimer);
        }

        this.inputStateSaveTimer = setTimeout(async () => {
            if (!this.contentService.isGenerating()) {
                await this.saveUIState();
            }
        }, this.INPUT_STATE_SAVE_DEBOUNCE);
    }

    /**
     * 保存 UI 状态到文件
     */
    async saveUIState(chatInput?: ChatInput, isBeingDeleted: boolean = false): Promise<void> {
        if (isBeingDeleted || !this.nodeId) return;

        const inputConfig = chatInput?.getConfig();

        const payload: UIState = {
            collapse_states: this.collapseStatesCache,
            input_text: inputConfig?.text,
            input_agent_id: inputConfig?.agentId,
        };

        await this.stateService.saveUIState(this.nodeId, payload);
    }

    /**
     * 加载 UI 状态
     */
    async loadUIState(): Promise<UIState | null> {
        const savedState = await this.stateService.loadUIState(this.nodeId);

        if (savedState?.collapse_states) {
            this.collapseStatesCache = savedState.collapse_states;
        }

        return savedState;
    }

    /**
     * 恢复输入状态
     */
    restoreInputState(
        chatInput: ChatInput,
        options: {
            initialInputState?: { text?: string; agentId?: string };
            isNewSession?: boolean;
            savedState?: UIState | null;
            sessionSettings?: any;
        }
    ): void {
        // 优先级 1：外部指定的初始状态
        if (options.initialInputState) {
            chatInput.setConfig({
                text: options.initialInputState.text || '',
                agentId: options.initialInputState.agentId || 'default',
            });
            return;
        }

        // 优先级 2：sessionStorage 中的创建参数
        const createParams = this.getAndClearCreateParams();
        if (createParams) {
            chatInput.setConfig({
                text: createParams.text || '',
                agentId: createParams.agentId || 'default',
            });
            return;
        }

        // 优先级 3：恢复已保存的状态（非新会话）
        if (!options.isNewSession && options.savedState) {
            chatInput.setConfig({
                text: options.savedState.input_text || '',
                agentId: options.savedState.input_agent_id || 'default',
                settings: options.sessionSettings,
            });
        }
    }

    /**
     * 获取并清除 sessionStorage 中的创建参数
     */
    private getAndClearCreateParams(): { agentId?: string; text?: string } | null {
        const key = 'app_create_params';
        const paramsJson = sessionStorage.getItem(key);

        if (!paramsJson) return null;

        try {
            const params = JSON.parse(paramsJson);

            const isValid = params.timestamp && (Date.now() - params.timestamp < 5 * 60 * 1000);
            const isTargetMatch = !params.target ||
                params.target === 'chat' ||
                params.target === 'llm-workspace';

            sessionStorage.removeItem(key);

            if (isValid && isTargetMatch) {
                return {
                    agentId: params.agentId,
                    text: params.text
                };
            }

            return null;

        } catch (e) {
            sessionStorage.removeItem(key);
            return null;
        }
    }

    /**
     * 清理定时器
     */
    cleanup(): void {
        if (this.uiStateSaveTimer) {
            clearTimeout(this.uiStateSaveTimer);
            this.uiStateSaveTimer = null;
        }

        if (this.inputStateSaveTimer) {
            clearTimeout(this.inputStateSaveTimer);
            this.inputStateSaveTimer = null;
        }
    }
}
