import { initApp } from '@itookit/app-shell';
import { openIndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { WORKSPACES } from './config/modules';
import { BrowserSkillToolHandlerFactory } from './harness/browser-skill-tools';

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
    await initApp({
        backend,
        workspaces: WORKSPACES,
        defaultSlug: 'chat',
        routeAliases: { home: 'llm-workspace' },
        harnessPlatform: {
            skillToolHandlerFactory: new BrowserSkillToolHandlerFactory(),
        },
    });
}

main().catch(err => console.error('[Bootstrap] Fatal:', err));
