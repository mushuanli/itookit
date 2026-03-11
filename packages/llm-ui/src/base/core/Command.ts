// @file: llm-ui/core/Command.ts

import { ErrorHandler, ErrorSeverity } from '../../utils/errorHandler';
import type { SessionManager } from '@itookit/llm-engine';
import type { SessionService } from '../services/SessionService';
import type { StateService } from '../services/StateService';
import type { AssetService } from '../services/AssetService';
import type { HistoryView } from '../../views/HistoryView';
import type { ChatInput } from '../../views/ChatInputView';
import type { EditorEventBus } from './EditorEventBus';

/**
 * 命令上下文 — 所有命令共享的依赖
 * 
 * 使用显式 import type 替代 inline import，避免路径问题。
 */
export interface CommandContext {
    sessionManager: SessionManager;
    sessionService: SessionService;
    stateService: StateService;
    assetService: AssetService;
    historyView: HistoryView;
    chatInput: ChatInput;
    bus: EditorEventBus;
    errorHandler: ErrorHandler;
    getNodeId: () => string;
    getOwnerNodeId: () => string;
}

/**
 * 命令基类
 * 
 * 每个命令封装一个独立的操作，自带错误处理。
 * 好处：
 *  1. 消除 LLMWorkspaceEditor 中的大量 handleXxx 方法
 *  2. 统一错误处理，不再每个方法 try-catch
 *  3. 开闭原则 — 新操作 = 新命令类，不修改已有代码
 */
export abstract class Command<TParams = void, TResult = void> {
    protected abstract readonly name: string;
    protected severity: ErrorSeverity = 'toast';

    constructor(protected ctx: CommandContext) { }

    async run(params: TParams): Promise<TResult | undefined> {
        return this.ctx.errorHandler.wrap(
            () => this.execute(params),
            this.name,
            this.severity
        );
    }

    protected abstract execute(params: TParams): Promise<TResult>;
}
