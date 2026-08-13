import { EditorFactory } from '@itookit/ui-common';
import type { IModuleFS } from '@itookit/stdio';

export interface WorkspaceStrategy {
    getFactory(): EditorFactory;
    getEngine(moduleName: string): IModuleFS;
}
