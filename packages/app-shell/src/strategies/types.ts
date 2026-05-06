import { EditorFactory, IFSEngine } from '@itookit/common';

export interface WorkspaceStrategy {
    getFactory(): EditorFactory;
    getEngine?(moduleName: string): IFSEngine;
}
