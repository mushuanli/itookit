// @file llm-ui/index.ts

import './styles/index.css';
export * from './core/types';
import { LLMWorkspaceEditor } from './LLMWorkspaceEditor';
import { VFSAgentService } from './services/VFSAgentService';
import { LLMSessionEngine } from './engine/LLMSessionEngine';
import { EditorFactory, EditorOptions, ILLMSessionEngine } from '@itookit/common';
import { VFSCore } from '@itookit/vfs-core';
import { AgentConfigEditor } from './editors/AgentConfigEditor';

export { ConnectionSettingsEditor } from './editors/ConnectionSettingsEditor';
export { MCPSettingsEditor } from './editors/MCPSettingsEditor';
export { DEFAULT_AGENT_CONTENT } from './constants';

// 扩展 EditorOptions
interface LLMFactoryOptions extends EditorOptions {
    // 工厂特定配置
}

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
 * ✨ [重构] 创建 LLM 编辑器工厂
 * 
 * @param agentService - Agent 服务（外部注入，确保单例）
 * @param sessionEngine - 会话引擎（可选，如果不传则内部创建）
 */
export const createLLMFactory = (
    agentService: VFSAgentService,
    sessionEngine?: ILLMSessionEngine
): EditorFactory => {
    // 缓存 Engine 实例
    let cachedEngine: ILLMSessionEngine | null = sessionEngine || null;
    let engineInitPromise: Promise<ILLMSessionEngine> | null = null;

    const getOrCreateEngine = async (): Promise<ILLMSessionEngine> => {
        if (cachedEngine) return cachedEngine;
        
        if (!engineInitPromise) {
            engineInitPromise = (async () => {
                const vfsCore = VFSCore.getInstance();
                const engine = new LLMSessionEngine(vfsCore);
                await engine.init();
                cachedEngine = engine;
                return engine;
            })();
        }
        
        return engineInitPromise;
    };

    return async (container: HTMLElement, options: EditorOptions) => {
        console.log(`[LLMFactory] START: nodeId=${options.nodeId}`);
        
        const engine = await getOrCreateEngine() as LLMSessionEngine;

        // ============================================
        // ✨ [核心修复] 在创建 Editor 之前确保 session 存在
        // ============================================
        let effectiveNodeId = options.nodeId;
        
        if (options.nodeId) {
            // 第一次检查
            console.log(`[LLMFactory] Checking session for nodeId: ${options.nodeId}`);
            let sessionId = await engine.getSessionIdFromNodeId(options.nodeId);
            console.log(`[LLMFactory] First check result: sessionId=${sessionId}`);
            
            if (!sessionId) {
                // ✨ [修复] 使用 initializeExistingFile，不创建新文件
                console.log('[LLMFactory] No valid session found. Initializing existing file...');
                
                const title = options.title || 'New Chat';
                
                try {
                    const newSessionId = await engine.initializeExistingFile(options.nodeId, title);
                    console.log(`[LLMFactory] initializeExistingFile returned: ${newSessionId}`);
                    
                    // ✨ [修复] 使用更可靠的等待方式
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    sessionId = await engine.getSessionIdFromNodeId(options.nodeId);
                    console.log(`[LLMFactory] Verification check result: sessionId=${sessionId}`);
                    
                    if (!sessionId) {
                        console.error(`[LLMFactory] CRITICAL: Session still not found after initialization!`);
                        throw new Error(`Failed to initialize session for nodeId: ${options.nodeId}`);
                    }
                } catch (e: any) {
                    console.error(`[LLMFactory] Failed to initialize file:`, e);
                    throw e;
                }
            }
            // 保持原有的 effectiveNodeId，不变
        } else {
            // 没有 nodeId，创建新文件
            console.log('[LLMFactory] No nodeId provided. Creating new chat file...');
            const newNode = await engine.createFile(options.title || 'New Chat', null);
            effectiveNodeId = newNode.id;
            console.log(`[LLMFactory] New file created: ${effectiveNodeId}`);
        }

        console.log(`[LLMFactory] Creating editor for nodeId: ${effectiveNodeId}`);
        
        const editorOptions = {
            ...options,
            agentService,
            sessionEngine: engine,
            nodeId: effectiveNodeId
        };
        
        console.log(`[LLMFactory] Creating editor for nodeId: ${effectiveNodeId}`);

        // 3. 创建编辑器
        const editor = new LLMWorkspaceEditor(container, editorOptions);

        // 4. 初始化
        await editor.init(container, options.initialContent);
        console.log(`[LLMFactory] Editor created successfully`);

        return editor;
    };
};

/**
 * 创建 Agent 配置编辑器工厂
 */
export const createAgentEditorFactory = (agentService: VFSAgentService): EditorFactory => {
    return async (container, options) => {
        const editor = new AgentConfigEditor(container, options, agentService);
        await editor.init(container, options.initialContent);
        return editor;
    };
};

// 导出 Engine 类供外部使用
//export { LLMSessionEngine };
export { VFSAgentService };
//export { LLMWorkspaceEditor };
//export { SessionManager } from './orchestrator/SessionManager';
//export { AgentExecutor } from './orchestrator/AgentExecutor';
//export { UnifiedExecutor, createAgent, createOrchestrator, serial, parallel, router, loop } from './orchestrator/Executor';
