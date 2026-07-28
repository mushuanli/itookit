import { EditorFactory, IModuleFS } from '@itookit/common';

export interface WorkspaceStrategy {
    getFactory(): EditorFactory;
    getEngine(moduleName: string): IModuleFS;
}
