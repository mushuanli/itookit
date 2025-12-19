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
 * - @itookit/vfs-core (文件系统)
 * - @itookit/common (公共接口和工具)
 */

// ============================================
// 核心类型
// ============================================

export * from './core/types';
export * from './core/errors';
export { ENGINE_DEFAULTS, STORAGE_KEYS, DEFAULT_AGENTS } from './core/constants';

// ============================================
// 会话管理
// ============================================

export { SessionManager } from './session/session-manager';
export type { DeleteOptions,RetryOptions,SessionSnapshot, SessionManagerOptions } from './session/session-manager';

export { SessionRegistry, getSessionRegistry } from './session/session-registry';
export { SessionState } from './session/session-state';
export { SessionRecovery } from './session/session-recovery';

// ============================================
// 适配器
// ============================================

export { KernelAdapter, getKernelAdapter } from './adapters/kernel-adapter';
export { PersistenceAdapter } from './adapters/persistence-adapter';
export { UIEventAdapter } from './adapters/ui-event-adapter';

// ============================================
// 持久化
// ============================================

export { LLMSessionEngine } from './persistence/session-engine';
export type { 
    ILLMSessionEngine, 
    ChatManifest, 
    ChatNode, 
    ChatContextItem 
} from './persistence/types';

// ============================================
// 服务
// ============================================

export type { 
    IAgentService, 
    AgentDefinition, 
    AgentConfig, 
    AgentType,
    MCPServer 
} from './services/agent-service';

import { VFSAgentService } from './services/vfs-agent-service';

// ============================================
// 工具
// ============================================

export { Converters } from './utils/converters';
export { 
    sleep, 
    throttle, 
    retry, 
    withTimeout, 
    safeJsonParse, 
    deepClone, 
    truncate, 
    formatFileSize, 
    formatDuration, 
    timeAgo 
} from './utils/helpers';
export {chatFileParser} from './utils/parsers';

// ============================================
// 初始化
// ============================================

import { SessionRegistry, getSessionRegistry } from './session/session-registry';
import { IAgentService } from './services/agent-service';
import { ILLMSessionEngine } from './persistence/types';
import { initializeKernel, KernelInitOptions } from '@itookit/llm-kernel';
import { LLMSessionEngine } from './persistence/session-engine';

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
}

/**
 * 初始化 LLM Engine
 */
export async function initializeLLMEngine(options: EngineInitOptions): Promise<{
    registry: SessionRegistry;
}> {
    // 1. 初始化 Kernel
    await initializeKernel({
        plugins: options.plugins,
        config: options.config
    });
    
    // 2. 初始化 Agent 服务
    await options.agentService.init();
    
    // 3. 初始化 Session 引擎
    await options.sessionEngine.init();
    
    // 4. 初始化 Registry
    const registry = getSessionRegistry();
    registry.initialize(
        options.agentService,
        options.sessionEngine,
        { maxConcurrent: options.maxConcurrent }
    );
    
    console.log('[LLM Engine] Initialized');
    
    return { registry };
}

/**
 * 快速初始化（使用默认配置）
 */
export async function quickInitialize(options: {
    vfs: any; // VFSCore
    maxConcurrent?: number;
    plugins?: any[];
}): Promise<{
    registry: SessionRegistry;
    agentService: IAgentService;
    sessionEngine: ILLMSessionEngine;
}> {
    
    const agentService = new VFSAgentService(options.vfs);
    const sessionEngine = new LLMSessionEngine(options.vfs);
    
    const { registry } = await initializeLLMEngine({
        agentService,
        sessionEngine,
        maxConcurrent: options.maxConcurrent,
        plugins: options.plugins
    });
    
    return { registry, agentService, sessionEngine };
}

export {VFSAgentService};