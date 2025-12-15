// @file llm-engine/index.ts

// 导出核心类型
import { VFSCore } from '@itookit/vfs-core';

// 导出引擎与服务
import { LLMSessionEngine,ILLMSessionEngine,VFSAgentService} from '@itookit/llmdriver';

// 导出编排器与管理器 (UI 主要与 SessionManager 交互)
import { SessionRegistry, getSessionRegistry } from './orchestrator/SessionRegistry';

export * from './core/types';
export * from './core/session';
export type {} from './services/IAgentService';
export { SessionManager } from './orchestrator/SessionManager';


/**
 * 专门针对 .chat 文件的解析逻辑
 */
export const chatFileParser = (content: string): any => {
    try {
        // 快速解析，不需要 YAML
        const data = JSON.parse(content);
        
        return {
            summary: data.summary || '',
            searchableText: `${data.title} ${data.summary || ''} ${data.id}`.toLowerCase(),
            metadata: {
                ...data.settings,
                type: 'chat',
                updatedAt: data.updated_at,
                messageCount: Object.keys(data.branches || {}).length
            }
        };
    } catch (e) {
        console.warn('[chatFileParser] Parse failed:', e);
        return { summary: 'Parse error', metadata: { type: 'chat' } };
    }
};

/**
 * 初始化 LLM 模块
 * 
 * 必须在使用任何 LLM 功能之前调用
 */
export async function initializeLLMModule(
    agentService: VFSAgentService,
    sessionEngine?: ILLMSessionEngine,
    options?: { maxConcurrent?: number }
): Promise<{
    registry: SessionRegistry;
    engine: ILLMSessionEngine;
}> {
    // 获取或创建 Engine
    let engine = sessionEngine;
    if (!engine) {
        const vfsCore = VFSCore.getInstance();
        const llmEngine = new LLMSessionEngine(vfsCore);
        await llmEngine.init();
        engine = llmEngine;
    }

    // 初始化 Registry
    const registry = getSessionRegistry();
    registry.initialize(agentService, engine, options);

    console.log('[LLM Module] Initialized');

    return { registry, engine };
}

export {VFSAgentService,SessionRegistry, getSessionRegistry};
// 导出常量
//export * from './constants';
