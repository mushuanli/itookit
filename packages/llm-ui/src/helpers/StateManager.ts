// @file: llm-ui/helpers/StateManager.ts

import { StateService, UIState } from '../base/services';
import { ChatInput } from '../views/ChatInputView';
import { CollapseStateMap } from '../base/core/types';
import { createDebouncedSave, DebouncedFn } from '../utils/debounce';
import { SessionManager } from '@itookit/llm-engine';
import { ErrorHandler } from '../utils/errorHandler';

/**
 * 状态管理器
 * 职责：防抖保存、缓存管理、状态恢复
 */
export class StateManager {
    private collapseStatesCache: CollapseStateMap = {};
    private debouncedUIStateSave: DebouncedFn;
    private debouncedInputStateSave: DebouncedFn;

    // ✅ 修复：持有 chatInput 引用的 getter，延迟绑定
    private chatInputGetter: (() => ChatInput | undefined) | null = null;

    // ✅ 新增：统一错误处理
    private errorHandler: ErrorHandler;

    constructor(
        private stateService: StateService,
        private sessionManager: SessionManager,
        private nodeId: string
    ) {
        this.errorHandler = new ErrorHandler({
            module: 'StateManager',
            defaultSeverity: 'silent', // 状态保存失败不需要打扰用户
        });

        const notGenerating = () => !this.sessionManager.isGenerating();

        this.debouncedUIStateSave = createDebouncedSave(
            () => this.saveUIState(),
            2000,
            notGenerating
        );

        this.debouncedInputStateSave = createDebouncedSave(
            () => this.saveUIState(this.chatInputGetter?.()),
            1000,
            notGenerating
        );
    }

    /**
     * ✅ 新增：绑定 chatInput（组件初始化后调用）
     */
    setChatInputGetter(getter: () => ChatInput | undefined): void {
        this.chatInputGetter = getter;
    }

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
     * 防抖保存 UI 状态（折叠变化时调用）
     */
    scheduleUIStateSave(states: CollapseStateMap): void {
        this.collapseStatesCache = states;
        this.debouncedUIStateSave();
    }

    /**
     * 防抖保存输入状态
     */
    scheduleInputStateSave(): void {
        this.debouncedInputStateSave();
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

        await this.errorHandler.wrap(
            () => this.stateService.saveUIState(this.nodeId, payload),
            'Save UI state',
            'silent'
        );
    }

    /**
     * 加载 UI 状态
     */
    async loadUIState(): Promise<UIState | null> {
        const result = await this.errorHandler.wrapWithFallback(
            () => this.stateService.loadUIState(this.nodeId),
            null,
            'Load UI state',
            'silent'
        );

        if (result?.collapse_states) {
            this.collapseStatesCache = result.collapse_states;
        }

        return result;
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
                return { agentId: params.agentId, text: params.text };
            }
            return null;
        } catch {
            sessionStorage.removeItem(key);
            return null;
        }
    }

    /**
     * 清理定时器
     */
    cleanup(): void {
        this.debouncedUIStateSave.cancel();
        this.debouncedInputStateSave.cancel();
    }
}
