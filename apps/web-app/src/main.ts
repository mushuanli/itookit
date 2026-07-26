import { initApp } from '@itookit/app-shell';
import { IndexedDBBackend } from '@itookit/vfsdriver-indexeddb';
import { WORKSPACES } from './config/modules';

import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
import '@itookit/llm-ui/style.css';
import '@itookit/app-settings/style.css';
import './styles/index.css';

// PWA service worker — network-first, non-blocking
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}

initApp({
    backend: new IndexedDBBackend({ dbName: 'MindOS-v3' }),
    workspaces: WORKSPACES,
    defaultSlug: 'chat',
    routeAliases: { home: 'llm-workspace' },
}).catch(err => console.error('[Bootstrap] Fatal:', err));
