// @file llm-ui/index.ts
import './styles/index.css';
export * from './types';
import { LLMWorkspaceEditor } from './LLMWorkspaceEditor';
import { VFSAgentService } from './services/VFSAgentService';
import { LLMSessionEngine } from './engine/LLMSessionEngine';
import { EditorFactory, EditorOptions, ILLMSessionEngine } from '@itookit/common';
import { VFSCore } from '@itookit/vfs-core';

// 扩展 EditorOptions 以包含我们需要的服务
// 这允许我们在 createLLMFactory 内部构造它们，或者从外部传入（如果需要共享单例）
interface LLMFactoryOptions extends EditorOptions {
    // 这里可以定义工厂特定的配置
}

export const createLLMFactory = (): EditorFactory => {
    return async (container: HTMLElement, options: EditorOptions) => {
        // 1. 获取核心依赖 (VFS)
        // 假设 VFSCore 已经初始化，或者我们在这里获取单例
        const vfsCore = VFSCore.getInstance(); 
        
        // 2. 创建服务实例
        const agentService = new VFSAgentService(vfsCore);
        const sessionEngine = new LLMSessionEngine(vfsCore);

        // 3. 执行 Service 初始化 (BaseModuleService 需要 init)
        await agentService.init();
        await sessionEngine.init();

        // 4. 注入到编辑器
        // 注意：我们需要强制转换 options 或者构造一个新的 options 对象来满足 LLMWorkspaceEditor 的签名
        const editorOptions = {
            ...options,
            agentService,
            sessionEngine
        };

        const editor = new LLMWorkspaceEditor(container, editorOptions);
        
        // 5. 执行编辑器初始化
        await editor.init(container, options.initialContent);
        
        return editor;
    };
};