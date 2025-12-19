// @file: llm-ui/index.ts

import './styles/index.css';

import { LLMWorkspaceEditor, LLMEditorOptions } from './LLMWorkspaceEditor';
import { 
    VFSAgentService, 
    ILLMSessionEngine, 
    initializeLLMEngine,
    SessionRegistry,
    getSessionRegistry
} from '@itookit/llm-engine';
import { EditorFactory, EditorOptions } from '@itookit/common';
import { AgentConfigEditor } from './editors/AgentConfigEditor';

export { ConnectionSettingsEditor } from './editors/ConnectionSettingsEditor';
export { MCPSettingsEditor } from './editors/MCPSettingsEditor';

// 扩展 EditorOptions
interface LLMFactoryOptions extends EditorOptions {
    // 工厂特定配置
}



/**
 * 创建 LLM 编辑器工厂
 * @param agentService 已初始化的 AgentService
 * @param sessionEngine 已初始化的 SessionEngine
 */
export const createLLMFactory = (
    agentService: VFSAgentService,
    sessionEngine: ILLMSessionEngine
): EditorFactory => {
    // 缓存初始化状态
    let moduleInitialized = false;
    let engineInitPromise: Promise<void> | null = null;

    /**
     * ✅ 修复：确保模块正确初始化
     */
    const ensureModuleInitialized = async (): Promise<void> => {
        if (moduleInitialized) {
            return;
        }

        if (!engineInitPromise) {
            engineInitPromise = (async () => {
                // ✅ 修复：使用正确的参数格式
                await initializeLLMEngine({
                    agentService,
                    sessionEngine,
                    maxConcurrent: 3
                });
                moduleInitialized = true;
            })();
        }

        return engineInitPromise;
    };

    return async (container: HTMLElement, options: EditorOptions) => {
        // 确保引擎初始化
        await ensureModuleInitialized();
        
        let effectiveNodeId = options.nodeId;

        if (!effectiveNodeId) {
            // 如果没有 nodeId，创建新文件
            const newNode = await sessionEngine.createFile(options.title || 'New Chat', null);
            effectiveNodeId = newNode.id;
            console.log(`[LLMFactory] New file created: ${effectiveNodeId}`);
        }

        // 此时 sessionEngine 应该已经在 main.ts 中通过 initializeLLMEngine 准备好了
        // 我们不需要在这里再次调用初始化逻辑，直接使用

        const editorOptions: LLMEditorOptions = {
            ...options,
            agentService,
            sessionEngine,
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

// 导出类型和类
export { VFSAgentService };
export type { LLMEditorOptions };
