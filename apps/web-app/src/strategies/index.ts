// @file: apps/strategies/index.ts
import { WorkspaceStrategy } from './types';
import { defaultEditorFactory } from '@itookit/mdxeditor';
import { ISessionEngine, EditorFactory } from '@itookit/common';
import { ILLMSessionEngine } from '@itookit/llm-engine';

// --- 1. 标准 MDx 工作区策略 ---
export class StandardWorkspaceStrategy implements WorkspaceStrategy {
    getFactory() { return defaultEditorFactory; }
    
}

// --- 2. Settings 工作区策略 ---
export class SettingsWorkspaceStrategy implements WorkspaceStrategy {
    constructor(
        private factory: EditorFactory, 
        private engine: ISessionEngine
    ) {}

    getFactory() { return this.factory; }
    getEngine() { return this.engine; } // 复用单例 Engine

}

// --- 3. Chat 工作区策略 ---
export class ChatWorkspaceStrategy implements WorkspaceStrategy {
    constructor(
        private factory: EditorFactory,
        private engine: ILLMSessionEngine 
    ) {}

    // MemoryManager 会调用此方法获取 Engine，并将其注入到 Options 中
    getEngine() {
        return this.engine;
    }

    getFactory() {
        return this.factory;
    }
}

// --- 4. Agent 工作区策略 (列表页) ---
export class AgentWorkspaceStrategy extends StandardWorkspaceStrategy {}
