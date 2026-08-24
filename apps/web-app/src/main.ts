import { initApp, type AppUI } from '@itookit/app-shell';
import { openIndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import {
    createLLMFactory,
    createAgentEditorFactory,
    createFlowsEditorFactory,
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

import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
import '@itookit/llm-ui/style.css';
import '@itookit/app-settings/style.css';
import './styles/index.css';

// PWA service worker — network-first, non-blocking
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}

async function main() {
    const backend = await openIndexedDBBackend({ dbName: 'MindOS-v3' });
    const ui: AppUI = {
        createChatEditor: createLLMFactory,
        createAgentEditor: createAgentEditorFactory,
        createFlowEditor: createFlowsEditorFactory,
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
    await initApp({
        backend,
        workspaces: WORKSPACES,
        defaultSlug: 'chat',
        routeAliases: { home: 'llm-workspace' },
        kernelPlatform: {
            skillToolHandlerFactory: new BrowserSkillToolHandlerFactory(),
        },
        ui,
    });
}

main().catch(err => console.error('[Bootstrap] Fatal:', err));
