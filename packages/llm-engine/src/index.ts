// @file: llm-engine/index.ts

/**
 * @package @itookit/llm-engine
 * @description LLM 会话引擎 - UI 适配层
 * 
 * 职责：
 * - 会话管理与状态协调
 * - UI 事件适配
 * - 持久化集成
 * - 多会话并发控制
 * 
 * 依赖：
 * - @itookit/llm-kernel (执行引擎)
 * - @itookit/llm-driver (LLM 通信)
 * - @itookit/vfs (文件系统)
 * - @itookit/common (公共接口和工具)
 */

// ============================================
// 核心类型
// ============================================

export * from './core/types';
export * from './core/errors';
export { ENGINE_DEFAULTS, STORAGE_KEYS } from './core/constants';

// ============================================
// 会话管理
// ============================================

export {
    SessionManager,
    createSessionManager,
    getSessionManager,
    resetSessionManager,
} from './session/session-manager';

export { SessionState } from './session/session-state';
export type { HistoryMessage } from './session/session-state';
export { SessionRecovery } from './session/session-recovery';
export { SessionEventBus } from './session/session-event-bus';

// ============================================
// 内部组件（高级用例可直接使用）
// ============================================

export { TaskRunner } from './session/task-runner';
export type { TaskRunnerOptions, TaskRunnerCallbacks } from './session/task-runner';

export { AgentResolver } from './session/agent-resolver';
export type { AgentInfo, ModelInfo } from './session/agent-resolver';

export { AttachmentProcessor } from './session/attachment-processor';

// ============================================
// 适配器
// ============================================

export { UIEventAdapter } from './adapters/ui-event-adapter';
export { LLMKernelAdapter, getLLMKernelAdapter } from './adapters/llmkernel-adapter';

// ============================================
// 持久化
// ============================================

export { LLMSessionEngine } from './persistence/session-engine';
export type {
    ILLMSessionEngine,
    ChatManifest,
    ChatNode,
    ChatContextItem,
    BranchTreeNode,
    AppendMessageMeta,
    UpdateMessageMeta,
    ChatNodeMeta,
} from './persistence/types';

// ============================================
// Prompt History
// ============================================
export { PromptHistoryService } from './services/prompt-history-service';
export type {
    PromptHistoryEntry,
    HistoryQueryOptions,
} from './services/prompt-history-service';

//export { VFSHistoryStorage } from './services/prompt-history-storage';

// ============================================
// 服务
// ============================================

export type {
    IAgentService,
    IAgentManagementService,
    MCPServer,
} from './services/agent-service';

export { VFSAgentService } from './services/vfs-agent-service';

// ============================================
// 工具
// ============================================

export { Converters } from './utils/converters';
export { chatFileParser } from './utils/parsers';
export { formatErrorMessage } from './utils/error-formatter';
export { createThrottledWriter } from './utils/throttled-writer';
export type { ThrottledWriter } from './utils/throttled-writer';

// ============================================
// 初始化
// ============================================

import { IAgentService } from './services/agent-service';
import { ILLMSessionEngine } from './persistence/types';
import { initializeKernel, KernelInitOptions } from '@itookit/llm-kernel';
import { LLMSessionEngine } from './persistence/session-engine';
import { VFSAgentService } from './services/vfs-agent-service';
import { SessionManager, createSessionManager } from './session/session-manager';
import { PromptHistoryService } from './services/prompt-history-service';

/**
 * Engine 初始化选项
 */
export interface EngineInitOptions extends KernelInitOptions {
    /** Agent 服务 */
    agentService: IAgentService;

    /** 会话引擎 */
    sessionEngine: ILLMSessionEngine;

    /** 最大并发数 */
    maxConcurrent?: number;
    /** ✅ 新增：可选，不传则自动创建 */
    promptHistory?: PromptHistoryService;
}

/**
 * 初始化 LLM Engine
 */
export async function initializeLLMEngine(options: EngineInitOptions): Promise<{
    sessionManager: SessionManager;
    promptHistory: PromptHistoryService | undefined;
}> {
    await initializeKernel({
        plugins: options.plugins,
        config: options.config,
    });

    await options.agentService.init();
    await options.sessionEngine.init();

    const sessionManager = createSessionManager(
        options.sessionEngine,
        options.agentService,
        {
            maxConcurrent: options.maxConcurrent,
            promptHistory: options.promptHistory,
        }
    );

    return { sessionManager, promptHistory: options.promptHistory };
}

/**
 * 快速初始化（使用默认配置）
 */
export async function quickInitialize(options: {
    vfs: any;
    maxConcurrent?: number;
    plugins?: any[];
}): Promise<{
    sessionManager: SessionManager;
    agentService: IAgentService;
    sessionEngine: ILLMSessionEngine;
    promptHistory: PromptHistoryService;
}> {
    const agentService = new VFSAgentService(options.vfs);
    const sessionEngine = new LLMSessionEngine(options.vfs);

    // ✅ 新增：创建并初始化 PromptHistoryService
    const promptHistory = new PromptHistoryService(options.vfs);
    await promptHistory.init();

    const { sessionManager } = await initializeLLMEngine({
        agentService,
        sessionEngine,
        maxConcurrent: options.maxConcurrent,
        plugins: options.plugins,
        promptHistory,
    });

    return { sessionManager, agentService, sessionEngine, promptHistory };
}
