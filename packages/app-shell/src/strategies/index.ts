import { WorkspaceStrategy } from './types';
import { defaultEditorFactory } from '@itookit/mdxeditor';
import { VFSModuleEngine } from '@itookit/vfslib';
import type { IVFSManager, IFSEngine, EditorFactory } from '@itookit/common';
import { IChatEngine } from '@itookit/llm-engine';

export class StandardWorkspaceStrategy implements WorkspaceStrategy {
    private engineCache = new Map<string, IFSEngine>();

    constructor(private vfs: IVFSManager) {}

    getFactory(): EditorFactory {
        return defaultEditorFactory;
    }

    getEngine(moduleName: string): IFSEngine {
        if (!this.engineCache.has(moduleName)) {
            this.engineCache.set(moduleName, new VFSModuleEngine(moduleName, this.vfs));
        }
        return this.engineCache.get(moduleName)!;
    }
}

export class SettingsWorkspaceStrategy implements WorkspaceStrategy {
    constructor(
        private factory: EditorFactory,
        private engine: IFSEngine,
    ) {}

    getFactory(): EditorFactory { return this.factory; }
    getEngine(_moduleName: string): IFSEngine { return this.engine; }
}

export class ChatWorkspaceStrategy implements WorkspaceStrategy {
    constructor(
        private factory: EditorFactory,
        private engine: IChatEngine,
    ) {}

    getFactory(): EditorFactory { return this.factory; }
    getEngine(_moduleName: string): IFSEngine { return this.engine; }
}
