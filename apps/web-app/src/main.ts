import { configureAppCache } from './app-cache';
import { createHttpSourceProvider } from '@itookit/vfsdriver-http';
import { initApp, installMobileNavigation, windowSessionLeaseToken, type AppUI } from '@itookit/app-shell';
import { createApplicationRuntime } from '@itookit/app-core';
import { openIndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import {
    createLLMFactory,
    createAgentEditorFactory,
    createFlowsEditorFactory,
    createFlowContextMenuConfig,
    installFlowLibrary,
    restoreFlowLibrary,
    createSkillsEditorFactory,
    createAIContextMenuConfig,
    ProviderSettingsEditor,
    ConnectionSettingsEditor,
    MCPSettingsEditor,
    CostEditor,
    SystemPromptSettingsEditor,
} from '@itookit/llm-ui';
import { WORKSPACES } from './config/modules';
import { BrowserSkillToolHandlerFactory } from './kernel/browser-skill-tools';

import '@fortawesome/fontawesome-free/css/all.min.css';
import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
import '@itookit/llm-ui/style.css';
import '@itookit/app-settings/style.css';
import './styles/index.css';

// Dev must always load the current workspace source graph.
void configureAppCache(import.meta.env.DEV).catch(error => console.warn('App cache setup failed', error));

async function main() {
    installMobileNavigation();
    const backend = await openIndexedDBBackend({ dbName: 'MindOS-v3' });
    const ui: AppUI = {
        createChatEditor: createLLMFactory,
        createAgentEditor: createAgentEditorFactory,
        createFlowEditor: createFlowsEditorFactory,
        createFlowContextMenu: createFlowContextMenuConfig,
        installFlowLibrary,
        restoreFlowLibrary,
        createSkillEditor: createSkillsEditorFactory,
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
