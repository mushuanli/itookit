import { WorkspaceStrategy } from './types';
import { defaultEditorFactory } from '@itookit/mdxeditor';
import { VFSModuleEngine } from '@itookit/vfslib';
import type { IVFSManager, ISessionEngine, EditorFactory } from '@itookit/common';
import { ILLMSessionEngine } from '@itookit/llm-engine';

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

export class SettingsWorkspaceStrategy implements WorkspaceStrategy {
    constructor(
        private factory: EditorFactory,
        private engine: ISessionEngine,
    ) {}

    getFactory(): EditorFactory { return this.factory; }
    getEngine(_moduleName: string): ISessionEngine { return this.engine; }
}

export class ChatWorkspaceStrategy implements WorkspaceStrategy {
    constructor(
        private factory: EditorFactory,
        private engine: ILLMSessionEngine,
    ) {}

    getFactory(): EditorFactory { return this.factory; }
    getEngine(_moduleName: string): ISessionEngine { return this.engine; }
}
