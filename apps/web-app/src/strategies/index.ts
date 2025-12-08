// @file: apps/strategies/index.ts
import { WorkspaceStrategy } from './types';
import { defaultEditorFactory } from '@itookit/mdxeditor';
import { createMDxEnhancer } from '@itookit/memory-manager'; // 假设 memory-manager 已按前文导出此 Helper
import { ISessionEngine, EditorFactory } from '@itookit/common';
import { EditorConfigEnhancer } from '@itookit/memory-manager';

// --- Helper: 通用宿主增强器 ---
// 适用于 SettingsEditor 或 CustomEditor
// 作用：将 MemoryManager 提供的 host 能力 (toggleSidebar, save) 直接挂载到 options.hostContext 上
const genericHostEnhancer: EditorConfigEnhancer = (options, { host }) => {
    return {
        ...options,
        // ✅ 优雅传递：注入到 options 中，BaseSettingsEditor 会读取它
        hostContext: host 
    };
};

// --- 1. 标准 MDx 工作区策略 ---
export class StandardWorkspaceStrategy implements WorkspaceStrategy {
    getFactory() { return defaultEditorFactory; }
    
    // 使用 memory-manager 提供的 MDx 专用增强器
    // 它会将 host 能力映射为 'core:titlebar' 插件的配置参数
    getConfigEnhancer(mentionScope?: string[]) {
        return createMDxEnhancer(mentionScope);
    }
}

// --- 2. Settings 工作区策略 ---
export class SettingsWorkspaceStrategy implements WorkspaceStrategy {
    constructor(
        private factory: EditorFactory, 
        private engine: ISessionEngine
    ) {}

    getFactory() { return this.factory; }
    getEngine() { return this.engine; } // 复用单例 Engine

    // ✅ 使用通用增强器，确保 Settings 页面也能控制侧边栏
    getConfigEnhancer() { 
        return genericHostEnhancer; 
    }
}

// --- 3. Chat 工作区策略 ---
export class ChatWorkspaceStrategy implements WorkspaceStrategy {
    constructor(private factory: EditorFactory) {}
    
    getFactory() { return this.factory; }
    
    // Chat 编辑器可能也需要控制侧边栏，注入通用能力
    getConfigEnhancer() { 
        return genericHostEnhancer; 
    }
}

// --- 4. Agent 工作区策略 (列表页) ---
export class AgentWorkspaceStrategy extends StandardWorkspaceStrategy {}
