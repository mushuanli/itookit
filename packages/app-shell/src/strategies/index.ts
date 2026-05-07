import { WorkspaceStrategy } from './types';
import { defaultEditorFactory } from '@itookit/mdxeditor';
import type { IVFSManager, IModuleFS, EditorFactory } from '@itookit/common';
import { IChatEngine } from '@itookit/llm-engine';

export class StandardWorkspaceStrategy implements WorkspaceStrategy {
    constructor(private vfs: IVFSManager) {}

    getFactory(): EditorFactory {
        return defaultEditorFactory;
    }

    getEngine(moduleName: string): IModuleFS {
        return this.vfs.getEngine(moduleName);
    }
}

export class SettingsWorkspaceStrategy implements WorkspaceStrategy {
    constructor(
        private factory: EditorFactory,
        private engine: IModuleFS,
    ) {}

    getFactory(): EditorFactory { return this.factory; }
    getEngine(_moduleName: string): IModuleFS { return this.engine; }
}

export class ChatWorkspaceStrategy implements WorkspaceStrategy {
    constructor(
        private factory: EditorFactory,
        private engine: IChatEngine,
    ) {}

    getFactory(): EditorFactory { return this.factory; }
    getEngine(_moduleName: string): IModuleFS { return this.engine as unknown as IModuleFS; }
}
