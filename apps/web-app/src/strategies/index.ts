// @file: apps/strategies/index.ts
import { WorkspaceStrategy } from './types';
import { defaultEditorFactory } from '@itookit/mdxeditor';
import { VFS, VFSModuleEngine } from '@itookit/vfs';
import { ISessionEngine, EditorFactory } from '@itookit/common';
import { ILLMSessionEngine } from '@itookit/llm-engine';

// --- 1. 标准 MDx 工作区策略 ---
export class StandardWorkspaceStrategy implements WorkspaceStrategy {
    private engineCache = new Map<string, ISessionEngine>();

    constructor(private vfs: VFS) {}

    getFactory(): EditorFactory {
        return defaultEditorFactory;
    }

    /**
     * ✅ 获取或创建 VFSModuleEngine
     * 使用缓存避免重复创建相同模块的 Engine
     */
    getEngine(moduleName: string): ISessionEngine {
        if (!this.engineCache.has(moduleName)) {
            const engine = new VFSModuleEngine(moduleName, this.vfs);
            this.engineCache.set(moduleName, engine);
        }
        return this.engineCache.get(moduleName)!;
    }
}

// ============================================
// 2. Settings 工作区策略
// ============================================

/**
 * Settings 工作区策略
 * 使用预创建的单例 Engine 和 Factory
 */
export class SettingsWorkspaceStrategy implements WorkspaceStrategy {
    constructor(
        private factory: EditorFactory,
        private engine: ISessionEngine
    ) {}

    getFactory(): EditorFactory {
        return this.factory;
    }

    /**
     * Settings 使用单例 Engine，忽略 moduleName 参数
     */
    getEngine(_moduleName: string): ISessionEngine {
        return this.engine;
    }
}

// ============================================
// 3. Chat 工作区策略
// ============================================

/**
 * Chat 工作区策略
 * 使用 LLMSessionEngine 作为后端
 */
export class ChatWorkspaceStrategy implements WorkspaceStrategy {
    constructor(
        private factory: EditorFactory,
        private engine: ILLMSessionEngine
    ) {}

    getFactory(): EditorFactory {
        return this.factory;
    }

    /**
     * Chat 使用单例 LLMSessionEngine，忽略 moduleName 参数
     */
    getEngine(_moduleName: string): ISessionEngine {
        return this.engine;
    }
}

// ============================================
// 4. Agent 工作区策略
// ============================================

/**
 * Agent 工作区策略
 * 继承 StandardWorkspaceStrategy，可以覆盖特定行为
 */
export class AgentWorkspaceStrategy extends StandardWorkspaceStrategy {
    constructor(vfs: VFS) {
        super(vfs);
    }

    // 可以在这里覆盖 getFactory() 如果 Agent 需要特殊编辑器
    // getFactory(): EditorFactory {
    //     return agentEditorFactory;
    // }
}

// ============================================
// 导出工厂函数（可选，简化创建）
// ============================================

/**
 * 创建标准策略
 */
export function createStandardStrategy(vfs: VFS): WorkspaceStrategy {
    return new StandardWorkspaceStrategy(vfs);
}

/**
 * 创建 Agent 策略
 */
export function createAgentStrategy(vfs: VFS): WorkspaceStrategy {
    return new AgentWorkspaceStrategy(vfs);
}
