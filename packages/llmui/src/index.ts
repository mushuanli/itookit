// @file llm-ui/index.ts

import './styles/index.css';

import { LLMWorkspaceEditor, LLMEditorOptions } from './LLMWorkspaceEditor';
import { VFSAgentService,initializeLLMModule } from '@itookit/llm-engine';
import { EditorFactory, EditorOptions, ILLMSessionEngine } from '@itookit/common';
import { AgentConfigEditor } from './editors/AgentConfigEditor';

export { ConnectionSettingsEditor } from './editors/ConnectionSettingsEditor';
export { MCPSettingsEditor } from './editors/MCPSettingsEditor';

// 扩展 EditorOptions
interface LLMFactoryOptions extends EditorOptions {
    // 工厂特定配置
}



/**
 * 创建 LLM 编辑器工厂
 */
export const createLLMFactory = (
    agentService: VFSAgentService,
    sessionEngine?: ILLMSessionEngine
): EditorFactory => {
    // 缓存 Engine 实例
    let cachedEngine: ILLMSessionEngine | null = sessionEngine || null;
    let engineInitPromise: Promise<ILLMSessionEngine> | null = null;
    let moduleInitialized = false;

    const ensureModuleInitialized = async (): Promise<ILLMSessionEngine> => {
        if (moduleInitialized && cachedEngine) {
            return cachedEngine;
        }

        if (!engineInitPromise) {
            engineInitPromise = (async () => {
                const { engine } = await initializeLLMModule(agentService, cachedEngine!);
                cachedEngine = engine;
                moduleInitialized = true;
                return engine;
            })();
        }

        return engineInitPromise;
    };

    return async (container: HTMLElement, options: EditorOptions) => {
        console.log(`[LLMFactory] Creating editor for nodeId=${options.nodeId}`);

        const engine = await ensureModuleInitialized();

        // 确保 session 存在
        let effectiveNodeId = options.nodeId;

        if (options.nodeId) {
            let sessionId = await engine.getSessionIdFromNodeId(options.nodeId);

            if (!sessionId) {
                console.log('[LLMFactory] Initializing new session...');
                const title = options.title || 'New Chat';

                try {
                    const newSessionId = await engine.initializeExistingFile(options.nodeId, title);
                    console.log(`[LLMFactory] Session initialized: ${newSessionId}`);

                    // 等待初始化完成
                    await new Promise(resolve => setTimeout(resolve, 100));

                    sessionId = await engine.getSessionIdFromNodeId(options.nodeId);

                    if (!sessionId) {
                        throw new Error(`Failed to initialize session for nodeId: ${options.nodeId}`);
                    }
                } catch (e: any) {
                    console.error(`[LLMFactory] Failed to initialize file:`, e);
                    throw e;
                }
            }
        } else {
            // 没有 nodeId，创建新文件
            console.log('[LLMFactory] Creating new chat file...');
            const newNode = await engine.createFile(options.title || 'New Chat', null);
            effectiveNodeId = newNode.id;
            console.log(`[LLMFactory] New file created: ${effectiveNodeId}`);
        }

        // 创建编辑器
        const editorOptions: LLMEditorOptions = {
            ...options,
            agentService,
            sessionEngine: engine,
            nodeId: effectiveNodeId
        };

        const editor = new LLMWorkspaceEditor(container, editorOptions);
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
