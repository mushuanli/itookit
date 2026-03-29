// @file: apps/strategies/index.ts
import { WorkspaceStrategy } from './types';
import { defaultEditorFactory } from '@itookit/mdxeditor';
import { VFSModuleEngine } from '@itookit/vfslib';
import type { IVFSManager } from '@itookit/common';
import { ISessionEngine, EditorFactory } from '@itookit/common';
import { ILLMSessionEngine } from '@itookit/llm-engine';

// --- 1. 标准 MDx 工作区策略 ---
export class StandardWorkspaceStrategy implements WorkspaceStrategy {
    private engineCache = new Map<string, ISessionEngine>();

    constructor(private vfs: IVFSManager) {}

    getFactory(): EditorFactory {
        return defaultEditorFactory;
    }

    getEngine(moduleName: string): ISessionEngine {
        if (!this.engineCache.has(moduleName)) {
            this.engineCache.set(moduleName, new VFSModuleEngine(moduleName, this.vfs));
        }
        return this.engineCache.get(moduleName)!;
    }
}

// ============================================
// 2. Settings 工作区策略
// ============================================

export class SettingsWorkspaceStrategy implements WorkspaceStrategy {
    constructor(
        private factory: EditorFactory,
        private engine: ISessionEngine
    ) {}

    getFactory(): EditorFactory {
        return this.factory;
    }

    getEngine(_moduleName: string): ISessionEngine {
        return this.engine;
    }
}

// ============================================
// 3. Chat 工作区策略
// ============================================

export class ChatWorkspaceStrategy implements WorkspaceStrategy {
    constructor(
        private factory: EditorFactory,
        private engine: ILLMSessionEngine
    ) {}

    getFactory(): EditorFactory {
        return this.factory;
    }

    getEngine(_moduleName: string): ISessionEngine {
        return this.engine;
    }
}

// ============================================
// 工厂函数
// ============================================

export function createStandardStrategy(vfs: IVFSManager): WorkspaceStrategy {
    return new StandardWorkspaceStrategy(vfs);
}

// Agent 工作区与 Standard 工作区行为完全一致，直接复用
export function createAgentStrategy(vfs: IVFSManager): WorkspaceStrategy {
    return new StandardWorkspaceStrategy(vfs);
}
