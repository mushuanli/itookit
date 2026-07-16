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
 * - @itookit/device-llm (LLM 通信)
 * - @itookit/vfslib (文件系统)
 * - @itookit/common (公共接口和工具)
 */

// ============================================
// 核心类型
// ============================================

export * from './core/types';
export * from './core/errors';
export { setKernelDeviceManager, getKernelDeviceManager } from './core/device-registry';
export { ENGINE_DEFAULTS, STORAGE_KEYS } from './core/constants';

// ── LLM 2.0: 协程式 Loop + Executor 注册表 ──────────────────────────

export { ExecutorRegistry, getExecutorRegistry, resetExecutorRegistry } from './core/executor-registry';
export { drive, resumeDrive, LoopAbortedError, notSupported } from './core/loop-driver';
export type { SessionActor as ISessionActor } from './core/loop-driver';
export { SessionActor } from './core/session-actor';
export { composeMiddleware } from './core/middleware-pipeline';
export type { MiddlewarePipeline } from './core/middleware-pipeline';

// ── LLM 2.0: Plugin system (CommandBus + ExtensionRegistry) ─────────

export { CommandBus } from './core/command-bus';
export { ExtensionRegistry } from './core/extension-registry';
export { createSessionPlugin } from './plugins/session-plugin';
export { createVcsPlugin } from './plugins/vcs-plugin';
export { createHistoryPlugin } from './plugins/history-plugin';

// ── LLM 2.0: Executors (ILoop implementations) ──────────────────────

export { chatExecutor, LoopExecutor, createLoopExecutor } from './executors';
export type { LoopPresetConfig, HarnessMiddlewareSet } from './executors';
export {
    createBudgetMiddleware,
    createErrorRecoveryMiddleware,
    createCompressionMiddleware,
    createHITLMiddleware,
    createSkillsMiddleware,
    createBackPressureMiddleware,
    createTruncationDetectionMiddleware,
} from './executors';

// ── LLM 2.0: Goal control loop (S5) ─────────────────────────────────

export {
    DependencyScheduler,
    CycleError as GoalCycleError,
    reconcile,
    createTruncationPredicate,
    createShellPredicate,
    createLLMJudgePredicate,
} from './core/goal';
export type { SchedulerSnapshot, ReconcileOptions } from './core/goal';

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
// 持久化
// ============================================

export { ChatEngine } from './persistence/chat-engine';
export { ChatEngineLog } from './persistence/chat-engine-log';
export { TurnLog } from './persistence/turn-log';
export { VFSDraftArea } from './persistence/draft-area';
export type { TurnManifest, TurnProjection, PersistedTurn } from './persistence/turn-types';
export type {
    IChatEngine,
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
// Mission Orchestration
// ============================================

export {
    TodoStateManager,
    ResultPersistenceService,
    MissionScheduler,
    MissionService,
    LiteSubAgentRouter,
    // S5: Goal-based scheduling adapters
    createMissionGoal,
    createSubAgentLoopAdapter,
} from './mission';
export type {
    MissionSchedulerOptions,
    MissionServiceOptions,
    SubAgentLoopAdapterOptions,
} from './mission';

// ============================================
// Session Dependency Graph
// ============================================
// File-based cross-session dependency system.
// Each VFS file = a session; dependencies declared via SessionMetaStore.
// GraphOrchestrator resolves the graph bottom-up and executes each session.

export {
    GraphOrchestrator,
    SessionMetaStore,
    CycleError,
    DEFAULT_SESSION_META,
    // S5: Goal-based scheduling adapters
    createGraphGoal,
    createAgentRuntimeLoopAdapter,
} from './session-graph';
export type {
    SessionMeta,
    SessionType,
    SessionStatus,
    SessionExecutionResult,
    GraphExecutionOptions,
    GraphEvent,
    GraphGoalResult,
} from './session-graph';

// ============================================
// File handles (implementations live in @itookit/vfslib)
// ============================================

export type { IChatFile } from '@itookit/common';
export { ChatFileHandle, createChatFile } from '@itookit/vfslib';

// ============================================
// 工具
// ============================================

export { Converters } from './utils/converters';
export { chatFileParser } from './utils/parsers';
export { formatErrorMessage } from './utils/error-formatter';

export { TruncationDetector } from './session/truncation-detector';
export type { TruncationResult } from './session/truncation-detector';

// ============================================
// 初始化
// ============================================

import type { ILLMService, ILoop } from '@itookit/common';
import { IAgentConfigService } from './services/agent-service';
import { IChatEngine } from './persistence/types';
import { ChatEngine } from './persistence/chat-engine';
import { SessionManager, createSessionManager } from './session/session-manager';
import { initializePromptHistory } from './services/prompt-history-service';
import { getExecutorRegistry } from './core/executor-registry';
import { chatExecutor } from './executors/chat-executor';
import { createLoopExecutor } from './executors/loop-presets';
import { CommandBus } from './core/command-bus';
import { ExtensionRegistry } from './core/extension-registry';
import { createSessionPlugin } from './plugins/session-plugin';
import { createVcsPlugin } from './plugins/vcs-plugin';
import { createHistoryPlugin } from './plugins/history-plugin';

/**
 * Engine 初始化选项
 */
export interface EngineInitOptions {
    /** Agent 服务 */
    agentService: IAgentConfigService;

    /** 会话引擎 */
    sessionEngine: IChatEngine;

    /** 最大并发数 */
    maxConcurrent?: number;

    /**
     * （可选）ILLMService 实例。
     *
     * 注入后所有 Agent Loop 策略统一通过此入口调用 LLM，
     * 不再通过 LLMKernelAdapter.streamRaw()。
     * 由 @itookit/llm-harness 的 createHarness().llmService 提供。
     */
    llmService?: ILLMService;

    /**
     * （可选）额外的 ILoop executor 列表。
     *
     * chat + loop(lite) executor 已默认注册。
     * 传入额外 executor（如 loop:full / mission / graph）以扩展执行模式。
     */
    executors?: ILoop[];
}

/**
 * 初始化 LLM Engine
 */
export async function initializeLLMEngine(options: EngineInitOptions): Promise<{
    sessionManager: SessionManager;
    commandBus: CommandBus;
}> {
    // S8: initializeKernel inlined — kernel package eliminated.
    // PluginManager was removed in S6a; KernelInitOptions.plugins/config were vestigial.
    console.log('[Kernel] Initialized');

    await options.agentService.init();
    await options.sessionEngine.init();

    // ✅ 直接访问 public readonly vfs
    const sessionEngine = options.sessionEngine as ChatEngine;
    if (sessionEngine.vfs) {
        await initializePromptHistory(sessionEngine.vfs).catch((e: any) => {
            console.warn('[LLM Engine] PromptHistory init failed (non-critical):', e);
        });
    }

    // ── Register default executors ──────────────────────────────────
    const registry = getExecutorRegistry();
    registry.register(chatExecutor);
    registry.register(createLoopExecutor('lite'));
    registry.setDefaultMode('chat');

    // Register any extra executors provided by the caller
    if (options.executors) {
        for (const executor of options.executors) {
            registry.register(executor);
        }
    }

    const sessionManager = createSessionManager(
        options.sessionEngine,
        options.agentService,
        { maxConcurrent: options.maxConcurrent }
    );

    // Wire ILLMService for unified LLM access
    if (options.llmService) {
        sessionManager.setLLMService(options.llmService);
    }

    // ── Plugin system: CommandBus + ExtensionRegistry ───────────────
    const commandBus = new CommandBus();
    const extensionRegistry = new ExtensionRegistry();

    // Register built-in plugins (dogfooding: they use the same public ICommandBus API)
    extensionRegistry.register(createSessionPlugin(sessionManager));
    extensionRegistry.register(createVcsPlugin(sessionManager));
    extensionRegistry.register(createHistoryPlugin(sessionManager));

    // Activate all plugins with a minimal ExtensionContext
    // ILog is not session-specific at engine init time; plugins that need it
    // should accept sessionManager as dependency (as the built-in plugins do).
    extensionRegistry.activate({
        log: null as any, // session-specific ILog injected per-session in future iterations
        commands: commandBus,
    });

    return { sessionManager, commandBus };
}
