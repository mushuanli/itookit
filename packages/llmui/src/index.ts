// @file llm-ui/index.ts

import './styles/index.css';
export * from './types';
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
        // 1. 获取或创建 Engine
        const engine = await getOrCreateEngine();

        // 2. 构建编辑器选项
        const editorOptions = {
            ...options,
            agentService,
            sessionEngine: engine,
            nodeId: options.nodeId // 确保传递 nodeId
        };

        // 3. 创建编辑器
        const editor = new LLMWorkspaceEditor(container, editorOptions);
        
        // 4. 初始化
        await editor.init(container, options.initialContent);
        
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
export { LLMSessionEngine };
export { VFSAgentService };
