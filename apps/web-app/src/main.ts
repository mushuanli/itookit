import { configureAppCache } from './app-cache';
import { createHttpSourceProvider } from '@itookit/vfsdriver-http';
import { initApp, installMobileNavigation, windowSessionLeaseToken, type AppUI } from '@itookit/app-shell';
import { createApplicationRuntime } from '@itookit/app-core';
import { openIndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { createFlowContextMenuConfig, createAIContextMenuConfig,
    installFlowLibrary, restoreFlowLibrary } from '@itookit/llm-ui/startup';
import {
    ProviderSettingsEditor,
    ConnectionSettingsEditor,
    MCPSettingsEditor,
    CostEditor,
    SystemPromptSettingsEditor,
} from '@itookit/llm-settings-ui';
import { WORKSPACES } from './config/modules';
import { BrowserSkillToolHandlerFactory } from './kernel/browser-skill-tools';

// Dev must always load the current workspace source graph.
void configureAppCache(import.meta.env.DEV).catch(error => console.warn('App cache setup failed', error));

type EditorFactory = ReturnType<AppUI['createChatEditor']>;

function lazyEditorFactory(load: () => Promise<EditorFactory>): EditorFactory {
    let pending: Promise<EditorFactory> | undefined;
    return async (container, options) => (await (pending ??= load()))(container, options);
}

async function main() {
    installMobileNavigation();
    const backend = await openIndexedDBBackend({ dbName: 'MindOS-v3' });
    const ui: AppUI = {
        createChatEditor: (service, deps) => lazyEditorFactory(async () =>
            (await import('@itookit/llm-ui/chat')).createLLMFactory(service, deps)),
        createAgentEditor: service => lazyEditorFactory(async () =>
            (await import('@itookit/llm-ui/settings')).createAgentEditorFactory(service)),
        createFlowEditor: deps => lazyEditorFactory(async () =>
            (await import('@itookit/llm-ui/chat')).createFlowsEditorFactory(deps)),
        createFlowContextMenu: createFlowContextMenuConfig,
        installFlowLibrary,
        restoreFlowLibrary,
        createSkillEditor: service => lazyEditorFactory(async () =>
            (await import('@itookit/llm-ui/settings')).createSkillsEditorFactory(service)),
        createAIContextMenu: createAIContextMenuConfig,
        llmUiEditors: {
            ProviderSettingsEditor,
            ConnectionSettingsEditor,
            MCPSettingsEditor,
            CostEditor,
            SystemPromptSettingsEditor,
        },
    };
    const runtime = await createApplicationRuntime({
        remoteSourceProvider: createHttpSourceProvider(),
        backend,
        ownerKind: 'web',
        // Same tab keeps its lease identity across reloads; other tabs keep their own.
        sessionOwnerToken: windowSessionLeaseToken(),
        kernelPlatform: {
            skillToolHandlerFactory: new BrowserSkillToolHandlerFactory(),
        },
    });
    try {
        await initApp({
            runtime,
            workspaces: WORKSPACES,
            defaultSlug: 'chat',
            routeAliases: { home: 'llm-workspace', projects: 'llm-workspace', workbench: 'llm-workspace' },
            ui,
        });
    } catch (error) {
        await runtime.dispose();
        throw error;
    }
}

main().catch(err => console.error('[Bootstrap] Fatal:', err));
