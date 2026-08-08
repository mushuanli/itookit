import { EditorFactory } from '@itookit/common';
import type { IModuleFS } from '@itookit/stdio';

export interface WorkspaceStrategy {
    getFactory(): EditorFactory;
    getEngine(moduleName: string): IModuleFS;
}
