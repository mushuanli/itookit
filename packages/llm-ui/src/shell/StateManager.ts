// @file: llm-ui/shell/StateManager.ts

import type { UIState, CollapseStateMap } from '../domain/types';
import type { IChatInputPresenter, IChatInputConfig } from '../domain/ports/IChatInputPresenter';
import type { StateService } from '../services/StateService';
import type { SessionManager } from '@itookit/llm-conversation';
import { createDebouncedSave, DebouncedFn } from '../utils/debounce';
import { ErrorHandler } from '../utils/errorHandler';
/**
 * 状态管理器
 *
 * ✅ 面向 IChatInputPresenter 接口，不依赖 ChatInput 实现
 * ✅ 支持新版 NavigationRequest.state 协议读取创建参数
 */
export class StateManager {
    private collapseStatesCache: CollapseStateMap = {};
    private historyVisibilityCache: 'visible' | 'hidden' = 'visible';
    private debouncedUIStateSave: DebouncedFn;
    private debouncedInputStateSave: DebouncedFn;
    private chatInputGetter: (() => IChatInputPresenter | undefined) | null = null;
    private errorHandler: ErrorHandler;

    constructor(
        private stateService: StateService,
        private sessionManager: SessionManager,
        private nodeId: string,
        private readonly validateAgentFn: (id: string) => string
    ) {
        this.errorHandler = new ErrorHandler({
            module: 'StateManager',
            defaultSeverity: 'silent',
        });

        const notGenerating = () => !this.sessionManager.isGenerating();

        this.debouncedUIStateSave = createDebouncedSave(
            () => this.saveUIState(),
            2000,
            notGenerating
        );

        this.debouncedInputStateSave = createDebouncedSave(
            () => this.saveUIState(this.chatInputGetter?.()?.getConfig()),
            1000,
            notGenerating
        );
    }

    setChatInputGetter(getter: () => IChatInputPresenter | undefined): void {
        this.chatInputGetter = getter;
    }

    updateNodeId(newNodeId: string): void {
        this.nodeId = newNodeId;
    }

    getCollapseStates(): CollapseStateMap { return this.collapseStatesCache; }

    setCollapseStates(states: CollapseStateMap): void {
        this.collapseStatesCache = states;
    }

    getHistoryVisibility(): 'visible' | 'hidden' { return this.historyVisibilityCache; }

    setHistoryVisibility(visibility: 'visible' | 'hidden'): void {
        this.historyVisibilityCache = visibility;
        this.debouncedUIStateSave();
    }

    scheduleUIStateSave(states: CollapseStateMap): void {
        this.collapseStatesCache = states;
        this.debouncedUIStateSave();
    }

    scheduleInputStateSave(): void {
        this.debouncedInputStateSave();
    }

    /**
     * ✅ 改动：接受 IChatInputConfig 而非 ChatInput 实例
     */
    async saveUIState(
        inputConfig?: IChatInputConfig,
        isBeingDeleted: boolean = false
    ): Promise<void> {
        if (isBeingDeleted || !this.nodeId) return;

        const payload: UIState = {
            collapse_states: this.collapseStatesCache,
            input_text: inputConfig?.text,
            input_agent_id: inputConfig?.agentId,
            history_visibility: this.historyVisibilityCache,
        };

        await this.errorHandler.wrap(
            () => this.stateService.saveUIState(this.nodeId, payload),
            'Save UI state', 'silent'
        );
    }

    async loadUIState(): Promise<UIState | null> {
        const result = await this.errorHandler.wrapWithFallback(
            () => this.stateService.loadUIState(this.nodeId),
            null, 'Load UI state', 'silent'
        );

        if (result?.collapse_states) {
            this.collapseStatesCache = result.collapse_states;
        }
        this.historyVisibilityCache = result?.history_visibility ?? 'visible';
        return result;
    }

    /**
     * 恢复输入状态 — 面向 IChatInputPresenter 接口
     * 
     * ✅ 新增 onTitleRestore 回调，支持从创建参数恢复标题
     */
    restoreInputState(
        chatInput: IChatInputPresenter,
        options: {
            initialInputState?: { text?: string; agentId?: string };
            isNewSession?: boolean;
            savedState?: UIState | null;
            sessionSettings?: any;
            onTitleRestore?: (title: string) => void;
        }
    ): void {
        const validate = (id: string) => this.validateAgentFn(id);

        // 优先级 1：外部指定的初始状态
        if (options.initialInputState) {
            chatInput.setConfig({
                text: options.initialInputState.text || '',
                agentId: validate(options.initialInputState.agentId || 'default'),
            });
            return;
        }

        // 优先级 2：NavigationRequest 创建参数（新版 + 旧版兼容）
        const createParams = this.getAndClearCreateParams();
        if (createParams) {
            chatInput.setConfig({
                text: createParams.text || '',
                agentId: validate(createParams.agentId || 'default'),
            });

            // 如果创建参数包含标题，通知 Shell 更新
            if (createParams.title && options.onTitleRestore) {
                options.onTitleRestore(createParams.title);
            }
            return;
        }

        // 优先级 3：恢复已保存的状态（非新会话）
        if (!options.isNewSession && options.savedState) {
            chatInput.setConfig({
                text: options.savedState.input_text || '',
                agentId: validate(options.savedState.input_agent_id || 'default'),
                settings: options.sessionSettings,
            });
            return;
        }

        // 兜底：保持现有 agentId，仅应用 settings
        if (!options.isNewSession && options.sessionSettings) {
            console.log('[StateManager] restoreInputState applying sessionSettings:', JSON.stringify(options.sessionSettings));
            const current = chatInput.getConfig();
            chatInput.setConfig({
                text: current.text,
                agentId: current.agentId,
                settings: options.sessionSettings,
            });
        }
    }

    /**
     * 读取并清除 sessionStorage 中的创建参数
     * 
     * ✅ 支持新版 NavigationRequest 协议的 title 字段
     */
    private getAndClearCreateParams(): { 
        agentId?: string; 
        text?: string;
        title?: string;
    } | null {
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

            if (!isValid || !isTargetMatch) return null;

            return { 
                agentId: params.agentId || params.state?.agentId,
                text: params.text || params.state?.inputText,
                title: params.title || params.create?.title,
            };
        } catch {
            sessionStorage.removeItem(key);
            return null;
        }
    }

    cleanup(): void {
        this.debouncedUIStateSave.cancel();
        this.debouncedInputStateSave.cancel();
    }
}
