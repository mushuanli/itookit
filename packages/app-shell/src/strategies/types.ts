import { EditorFactory } from '@itookit/ui-common';
import type { IModuleFS } from '@itookit/vfs-core';

export interface WorkspaceStrategy {
    getFactory(): EditorFactory;
    getEngine(moduleName: string): IModuleFS;
}
