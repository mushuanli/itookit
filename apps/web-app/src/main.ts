import { createMindosFlowLibrary } from '@itookit/app-core';
import { configureAppCache } from './app-cache';
import { createPiAgentDriver } from '@itookit/piagent-driver';
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
import { WebProjectSync } from './sync';

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
        createAgentEditor: (service, capabilities) => lazyEditorFactory(async () =>
            (await import('@itookit/llm-ui/settings')).createAgentEditorFactory(service, capabilities)),
        createFlowEditor: deps => lazyEditorFactory(async () =>
            (await import('@itookit/llm-ui/chat')).createFlowsEditorFactory(deps)),
        createFlowContextMenu: deps => createFlowContextMenuConfig({ ...deps, library: createMindosFlowLibrary() }),
        installFlowLibrary: commands => installFlowLibrary(commands, createMindosFlowLibrary()),
        restoreFlowLibrary: commands => restoreFlowLibrary(commands, createMindosFlowLibrary()),
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
    const remoteSourceProvider = createPiAgentDriver();
    const sync = new WebProjectSync(backend, remoteSourceProvider);
    const runtime = await createApplicationRuntime({
        remoteSourceProvider,
        sync: { provider: sync, coordinator: sync.coordinator },
        backend,
        ownerKind: 'web',
        // Same tab keeps its lease identity across reloads; other tabs keep their own.
        sessionOwnerToken: windowSessionLeaseToken(),
        kernelPlatform: {
            skillToolHandlerFactory: new BrowserSkillToolHandlerFactory(),
        },
    });
    sync.projects = runtime.projects;
    sync.service = runtime.projectSync;
    try {
        await initApp({
            runtime,
            projectSyncSetup: (id, signal) => sync.setup(id, signal),
            projectSyncDirectory: (id, signal) => sync.directory(id, signal),
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
