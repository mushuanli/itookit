import { EditorFactory, ISessionEngine } from '@itookit/common';

export interface WorkspaceStrategy {
    getFactory(): EditorFactory;
    getEngine?(moduleName: string): ISessionEngine;
}
