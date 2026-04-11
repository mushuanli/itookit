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
 * - @itookit/device-llm (LLM 通信)
 * - @itookit/vfslib (文件系统)
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
export {
    HarnessAdapter,
    initHarnessAdapter,
    getHarnessAdapter,
    resetHarnessAdapter,
} from './adapters/harness-adapter';

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
export { getPromptHistory, PromptHistoryService } from './services/prompt-history-service';
export type {
    PromptHistoryEntry,
    HistoryQueryOptions,
} from './services/prompt-history-service';

//export { VFSHistoryStorage } from './services/prompt-history-storage';

// ============================================
// 服务
// ============================================

export type {
    IAgentConfigService,
    IAgentManagementService,
    IConnectionService,
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

export { TruncationDetector } from './session/truncation-detector';
export type { TruncationResult } from './session/truncation-detector';

export { AutoContinueHandler } from './session/auto-continue';
export type {
    AutoContinueConfig,
    ContinueDecision,
} from './session/auto-continue';

// ============================================
// 初始化
// ============================================

import type { IAgentRuntime, ISkillService, IToolService } from '@itookit/common';
import { IAgentConfigService } from './services/agent-service';
import { ILLMSessionEngine } from './persistence/types';
import { initializeKernel, KernelInitOptions } from '@itookit/llm-kernel';
import { LLMSessionEngine } from './persistence/session-engine';
import { SessionManager, createSessionManager } from './session/session-manager';
import { initializePromptHistory } from './services/prompt-history-service';
import { initHarnessAdapter } from './adapters/harness-adapter';

/**
 * Engine 初始化选项
 */
export interface EngineInitOptions extends KernelInitOptions {
    /** Agent 服务 */
    agentService: IAgentConfigService;

    /** 会话引擎 */
    sessionEngine: ILLMSessionEngine;

    /** 最大并发数 */
    maxConcurrent?: number;

    /**
     * （可选）AgentLoopExecutor 运行时。
     *
     * 提供后，发送消息时可通过 overrides.useHarness=true 切换到
     * 多轮 Agent 循环（含工具调用、上下文压缩、反压验证）。
     * 由 @itookit/llm-harness 的 createHarness() 创建。
     */
    harnessRuntime?: IAgentRuntime;

    /**
     * （可选）Skill 服务实例。
     *
     * 与 harnessRuntime 配合使用，注入后 ChatInput 的
     * Skill 选择面板可以列出、加载、卸载 Skill。
     * 由 @itookit/llm-harness 的 createHarness().skillService 提供。
     */
    harnessSkillService?: ISkillService;

    /**
     * （可选）Tool 服务实例。
     *
     * 注入后 ChatInput 的 `/exec` `/read` `/grep` `/glob` slash 命令可以
     * 直接调用 harness 内置工具，绕过 LLM 直接执行并在 Modal 中展示结果。
     * 由 @itookit/llm-harness 的 createHarness().toolService 提供。
     */
    harnessToolService?: IToolService;
}

/**
 * 初始化 LLM Engine
 */
export async function initializeLLMEngine(options: EngineInitOptions): Promise<{
    sessionManager: SessionManager;
}> {
    await initializeKernel({
        plugins: options.plugins,
        config: options.config,
    });

    await options.agentService.init();
    await options.sessionEngine.init();

    // ✅ 直接访问 public readonly vfs
    const sessionEngine = options.sessionEngine as LLMSessionEngine;
    if (sessionEngine.vfs) {
        await initializePromptHistory(sessionEngine.vfs).catch((e: any) => {
            console.warn('[LLM Engine] PromptHistory init failed (non-critical):', e);
        });
    }

    const sessionManager = createSessionManager(
        options.sessionEngine,
        options.agentService,
        { maxConcurrent: options.maxConcurrent }
    );

    // Wire harness if provided
    if (options.harnessRuntime) {
        const harnessAdapter = initHarnessAdapter(options.harnessRuntime);
        if (options.harnessSkillService) {
            harnessAdapter.setSkillService(options.harnessSkillService);
        }
        if (options.harnessToolService) {
            harnessAdapter.setToolService(options.harnessToolService);
        }
        sessionManager.setHarnessAdapter(harnessAdapter);
    }

    return { sessionManager };
}
