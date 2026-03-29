// @file: apps/tauri-app/src/strategies/types.ts
import { EditorFactory, ISessionEngine } from '@itookit/common';

export interface WorkspaceStrategy {
    getFactory(): EditorFactory;
    getEngine?(moduleName: string): ISessionEngine;
}
